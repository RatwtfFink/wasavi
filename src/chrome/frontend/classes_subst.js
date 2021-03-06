// ==UserScript==
// @include http://wasavi.appsweets.net/
// @include http://wasavi.appsweets.net/?testmode
// @include https://ss1.xrea.com/wasavi.appsweets.net/
// ==/UserScript==
//
/**
 * wasavi: vi clone implemented in javascript
 * =============================================================================
 *
 *
 * @author akahuku@gmail.com
 */
/**
 * Copyright 2012-2015 akahuku, akahuku@gmail.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

Wasavi.SubstituteWorker = function (app) {
	this.app = app;
	this.patternString = '';
	this.pattern = null;
	this.replOpcodes = null;
	this.range = null;
	this.isGlobal = false;
	this.isConfirm = false;
	this.substCount = 0;
	this.buffer = null;
	this.k = null;
};
Wasavi.SubstituteWorker.prototype = {
	run: function (range, pattern, repl, options) {
		var app = this.app;
		var t = this.app.buffer;
		pattern || (pattern = '');
		repl || (repl = '');
		options || (options = '');
		var count, re, tildeUsed;

		// pattern and replacemnt
		if (pattern == '' && repl == '') {
			if ((pattern = app.lastSubstituteInfo.pattern || '') == '') {
				return _('No previous substitution.');
			}
			repl = app.config.vars.magic ? '~' : '\\~';
		}
		else if (pattern == '' && repl != '') {
			if ((pattern = app.lastRegexFindCommand.pattern || '') == '') {
				return _('No previous search pattern.');
			}
		}
		if (repl == '%') {
			if (app.lastSubstituteInfo.replacement == undefined) {
				return _('No previous substitution.');
			}
			repl = app.lastSubstituteInfo.replacement;
		}
		repl.replace(/\\.|./g, function (a) {
			if (a == '\\~' && !app.config.vars.magic
			||  a == '~' && app.config.vars.magic) {
				tildeUsed = true;
			}
		});
		if (tildeUsed) {
			if (app.lastSubstituteInfo.replacement == undefined) {
				return _('No previous substitution.');
			}
			var tildeRegex = app.config.vars.magic ? /(?!\\)~/g : /\\~/g;
			repl = repl.replace(tildeRegex, app.lastSubstituteInfo.replacement);
		}

		// options
		re = /^\s*([gc]+)/.exec(options);
		if (re) {
			if (re[1].indexOf('g') >= 0) {
				this.isGlobal = true;
			}
			if (re[1].indexOf('c') >= 0) {
				this.isConfirm = true;
			}
			options = options.substring(re[0].length);
		}

		// count
		re = /^\s*(\d+)/.exec(options);
		if (re) {
			count = parseInt(re[1], 10);
			range[0] = range[1];
			range[1] = Math.max(0, Math.min(range[0] + count - 1, t.rowLength - 1));
			options = options.substring(re[0].length);
		}

		// update search history
		app.lastRegexFindCommand.push({direction:1});
		app.lastRegexFindCommand.setPattern(pattern);
		app.lastSubstituteInfo.pattern = pattern;
		app.lastSubstituteInfo.replacement = repl;
		app.registers.set('/', app.lastRegexFindCommand.pattern);

		// initialize regex instance
		this.patternString = pattern;
		this.pattern = app.low.getFindRegex(pattern);
		this.pattern.lastIndex = 0;

		// compile the replace pattern into opcodes
		this.replOpcodes = this.compileReplacer(repl);
		if (!this.replOpcodes) {
			return _('Internal Error: invalid replace function');
		}

		// create search buffer
		var rg = document.createRange();
		rg.setStartBefore(t.rowNodes(range[0]));
		rg.setEndAfter(t.rowNodes(range[1]));
		this.buffer = this.createBuffer(trimTerm(rg.toString()));

		if (this.buffer.length) {
			// found something
			this.range = range;
			this.substCount = 0;

			if (this.isConfirm) {
				this.k = {
					bufferPos: 0,
					pos: null,
					posPrev: null,
					indexPrev: -1,
					delta: 0,
					lastRow: -1
				};

				this.kontinue();
				app.exvm.hideOverlay();
				return app.exvm.EX_ASYNC;
			}
			else {
				this.burst();
			}
		}
		else {
			// not found
			this.showNotFound();
		}
	},
	createBuffer: function (text) {
		var re;
		var buffer = [];
		var lastIndex = -1;
		var pattern = this.pattern;

		while ((re = pattern.exec(text))) {
			if (pattern.lastIndex <= lastIndex) {
				pattern.lastIndex = lastIndex + 1;
				continue;
			}
			buffer.push(re);
			lastIndex = pattern.lastIndex;
		}

		return buffer;
	},
	burst: function () {
		var t = this.app.buffer;
		var buffer = this.buffer;
		var indexPrev = 0;
		var delta = 0;
		var lastRow = -1;
		var pos;
		var posPrev;
		var replacer;

		posPrev = new Wasavi.Position(this.range[0], 0);

		for (var i = 0, goal = buffer.length; i < goal; i++) {
			pos = t.offsetBy(posPrev, buffer[i].index - indexPrev + delta);

			if (this.isGlobal || pos.row > lastRow) {
				replacer = this.executeReplacer(buffer[i]);
				delta = replacer.length - buffer[i][0].length;
				lastRow = pos.row;
				this.doSubstitute(pos, buffer[i][0].length, replacer);
			}
			else {
				delta = 0;
			}

			indexPrev = buffer[i].index;
			posPrev = pos;
		}

		t.setSelectionRange(t.getLineTopOffset2(t.selectionStart));

		this.showResult();
		this.buffer = null;
	},
	kontinue: function (action) {
		var t = this.app.buffer;

		if (action == undefined) {
			this.k.posPrev = new Wasavi.Position(this.range[0], 0);
			this.k.pos = t.offsetBy(this.k.posPrev, this.buffer[this.k.bufferPos].index);

			t.setSelectionRange(this.k.pos);
			this.app.cursor.ensureVisible();
			t.emphasis(this.k.pos, this.buffer[this.k.bufferPos][0].length);

			this.app.low.requestInputMode('ex_s_prompt');
			this.app.requestedState.modeline = null;
			this.app.low.requestShowMessage(
				_('Substitute? ([y]es, [n]o, [q]uit)'),
				false, true, true);
			return;
		}

		if (this.k.bufferPos < this.buffer.length) {
			t.unEmphasis();

			switch (action.toLowerCase()) {
			case 'y':
				if (this.isGlobal || this.k.pos.row != this.k.lastRow) {
					var replacer = this.executeReplacer(this.buffer[this.k.bufferPos]);
					this.k.delta = replacer.length - this.buffer[this.k.bufferPos][0].length;
					this.k.lastRow = this.k.pos.row;
					this.doSubstitute(
						this.k.pos,
						this.buffer[this.k.bufferPos][0].length,
						replacer);
					this.app.editLogger.close().open('ex+s');
				}
				else {
					this.k.delta = 0;
				}
				/*FALLTHRU*/

			case 'n':
				this.k.indexPrev = this.buffer[this.k.bufferPos].index;
				this.k.bufferPos++;
				break;

			case 'q':
			case '\u001b':
				this.k.bufferPos = this.buffer.length;
				break;

			default:
				t.emphasis(this.k.pos, this.buffer[this.k.bufferPos][0].length);
				this.app.low.requestRegisterNotice();
				return true;
			}
		}

		if (this.k.bufferPos < this.buffer.length) {
			this.k.posPrev = this.k.pos;
			this.k.pos = t.offsetBy(
				this.k.posPrev,
				this.buffer[this.k.bufferPos].index - this.k.indexPrev + this.k.delta);

			t.setSelectionRange(this.k.pos);
			this.app.cursor.ensureVisible();
			t.emphasis(this.k.pos, this.buffer[this.k.bufferPos][0].length);

			return true;
		}

		if (this.buffer.length == this.substCount) {
			t.setSelectionRange(t.getLineTopOffset2(t.selectionStart));
		}

		this.app.low.popInputMode();
		this.app.cursor.ensureVisible();
		this.app.exvm.showOverlay();
		this.app.exvm.inst.currentOpcode.worker = null;
		this.showResult();
		this.k = this.buffer = null;
	},
	doSubstitute: function (pos, length, replacer) {
		var t = this.app.buffer;
		t.selectionStart = pos;
		t.selectionEnd = t.offsetBy(t.selectionStart, length);
		this.app.edit.insert(replacer);
		this.substCount++;
	},
	showResult: function (immediate) {
		if (this.substCount) {
			var line = _('{0} {substitution:0} on {1} {line:1}.', this.substCount, this.range[1] - this.range[0] + 1);
			immediate ? this.app.low.showMessage(line) : this.app.low.requestShowMessage(line);
			this.app.isEditCompleted = true;
		}
	},
	showNotFound: function () {
		this.app.low.requestShowMessage(_('Pattern not found: {0}', this.patternString));
	},
	executeReplacer: function (re, opcodes) {
		opcodes || (opcodes = this.replOpcodes);
		if (!opcodes) return '';

		var result = [];
		for (var i = 0, goal = opcodes.length; i < goal; i++) {
			switch (opcodes[i].x) {
			case 0:
				result.push(opcodes[i].v);
				break;
			case 1:
				result.push(re[opcodes[i].v] || '');
				break;
			case 2:
				if (result.length) {
					var tmp = result.lastItem;
					tmp = tmp.charAt(0).toUpperCase() + tmp.substring(1);
					result.lastItem = tmp;
				}
				break;
			case 3:
				if (result.length) {
					var tmp = result.lastItem;
					tmp = tmp.charAt(0).toLowerCase() + tmp.substring(1);
					result.lastItem = tmp;
				}
				break;
			case 4:
				if (result.length) {
					result.lastItem = result.lastItem.toUpperCase();
				}
				break;
			case 5:
				if (result.length) {
					result.lastItem = result.lastItem.toLowerCase();
				}
				break;
			}
		}
		return result.join('');
	},
	compileReplacer: function (repl) {
		/*
		 * Meta characters in replacement string are:
		 *
		 * &        matched text
		 * \0 - \9  back reference in the matched text
		 * \u, \l   capitalize the next letter
		 *
		 *              \uabc -> Abc
		 *              \u\0 -> Def
		 *                  (if \0 equals 'def')
		 *
		 * \U, \L   capitalize whole letter till \e, \E or end of replacement string
		 *
		 *              \Uabc\E -> ABC
		 *              \U\0 -> DEF
		 *                  \0 equals 'def')
		 *
		 * \e, \E   end of \u, \l, \U, \L
		 */

		if (repl == '') return [];

		var stack = [];
		var specialEscapes = {'\\':'\\', 'n':'\n', 't':'\t'};
		var specialLetters = {'\r':'\n'};
		var magic = this.app.config.vars.magic;
		function loop (callDepth, interruptMode, start) {
			/*
			 * opcodes:
			 *   0: literal
			 *   1: backref
			 *   2: upper first
			 *   3: lower first
			 *   4: upper
			 *   5: lower
			 */
			var newOperand = true;
			for (var i = start; i < repl.length; i++) {
				var ch = repl.charAt(i);
				var ate = false;
				if (ch == '\\') {
					if (++i >= repl.length) {
						return i;
					}
					ch += repl.charAt(i);
				}
				switch (ch) {
				case '&': case '\\&':
					if (ch == '&' && magic || ch == '\\&' && !magic) {
						stack.push({x:1, v:0});
						ate = newOperand = true;
					}
					break;
				case '\\0': case '\\1': case '\\2': case '\\3': case '\\4':
				case '\\5': case '\\6': case '\\7': case '\\8': case '\\9':
					stack.push({x:1, v:ch.charAt(1)});
					ate = newOperand = true;
					break;
				case '\\u':
					i = loop(callDepth + 1, 1, i + 1);
					stack.push({x:2});
					ate = newOperand = true;
					break;
				case '\\l':
					i = loop(callDepth + 1, 1, i + 1);
					stack.push({x:3});
					ate = newOperand = true;
					break;
				case '\\U':
					i = loop(callDepth + 1, 2, i + 1);
					stack.push({x:4});
					ate = newOperand = true;
					break;
				case '\\L':
					i = loop(callDepth + 1, 2, i + 1);
					stack.push({x:5});
					ate = newOperand = true;
					break;
				case '\\e': case '\\E':
					if (callDepth && interruptMode == 2) return i;
					ate = newOperand = true;
					break;
				}
				if (!ate) {
					if (ch.length >= 2 && ch.charAt(0) == '\\') {
						ch = ch.charAt(1);
						ch = specialEscapes[ch] || ch;
					}
					var code = ch.charCodeAt(0);
					if (specialLetters[ch]) {
						ch = specialLetters[ch];
					}
					else if (code >= 0x00 && code != 0x09 && code != 0x0a && code <= 0x1f
					|| code == 0x7f) {
						ch = toVisibleControl(code);
					}
					if (newOperand || stack.length == 0) {
						stack.push({x:0, v:ch});
						newOperand = false;
					}
					else if (stack.length && stack.lastItem.x == 0) {
						stack.lastItem.v += ch;
					}
				}
				if (callDepth && interruptMode == 1) {
					return i;
				}
			}
			return i;
		}
		loop(0, 0, 0);
		return stack;
	}
};

// vim:set ts=4 sw=4 fenc=UTF-8 ff=unix ft=javascript fdm=marker :
