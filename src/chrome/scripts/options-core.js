/**
 * main logics of options page
 *
 * @author akahuku@gmail.com
 */
/**
 * Copyright 2012-2014 akahuku, akahuku@gmail.com
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

(function (global) {

var SAVED_MESSAGE_VISIBLE_SECS = 2;

var extension;

function $ (arg) {
	return typeof arg == 'string' ? document.getElementById(arg) : arg;
}

/**
 * page initializer
 * ----------------
 */

function initPage (req) {
	/*
	 * initialize form elements
	 */

	var el;

	// exrc
	el = $('exrc');
	if (el && el.nodeName == 'TEXTAREA') {
		el.value = req.exrc;
	}

	// targets
	for (var i in req.targets) {
		el = $(i);
		if (el && el.nodeName == 'INPUT' && el.type == 'checkbox') {
			el.checked = req.targets[i];
		}
	}

	// quick activation
	el = document.querySelector([
		'input',
		'[name="quick-activation"]',
		'[value="' + (req.quickActivation ? '1' : '0') + '"]'
	].join(''));
	if (el) {
		el.checked = true;
	}

	// shortcut
	el = $('shortcut');
	if (el && el.nodeName == 'INPUT') {
		el.value = req.shortcut;
	}

	// font family
	el = $('font-family');
	if (el && el.nodeName == 'INPUT') {
		el.value = req.fontFamily;
	}

	// sounds
	for (var i in req.sounds) {
		el = $('sound-' + i);
		if (el && el.nodeName == 'INPUT' && el.type == 'checkbox') {
			el.checked = req.sounds[i];
		}
	}
	el = $('sound-volume');
	if (el && el.nodeName == 'INPUT') {
		el.value = req.soundVolume;
	}

	// fstab
	var defaultFs = req.fstab
		.filter(function (fs) {return fs.isDefault})[0];
	el = document.querySelector([
		'input',
		'[name="fstab"]',
		'[value="' + (defaultFs ? defaultFs.name : '') + '"]'
	].join(''));
	if (el) {
		el.checked = true;
	}

	// log mode
	el = $('log-mode');
	if (el && el.nodeName == 'INPUT') {
		el.checked = req.logMode;
	}

	/*
	 * replace all message ids to translated one
	 */

	var converter = {
		option_target_elements_desc: function (node, message) {
			node = node.parentNode;
			node.textContent = '';
			var ul = node.appendChild(document.createElement('ul'));
			message
			.replace(/^\s*\*\s*/, '')
			.split(/\n\*\s*/)
			.map(function (line) {
				var li = ul.appendChild(document.createElement('li'));
				li.textContent = line;
			});
		}
	};
	var iter = document.createNodeIterator(
		document, window.NodeFilter.SHOW_TEXT, null, false);
	var defaultConverter = function (node, message) {
		node.nodeValue = message;
	};

	var texts = [];
	for (var node = iter.nextNode(); node; node = iter.nextNode()) {
		var re = /^\s*__MSG_(.+)__\s*$/.exec(node.textContent);
		re && texts.push([node, re[1]]);
	}

	texts.forEach(function (text) {
		var node = text[0];
		var id = text[1];

		var message;
		if (req.messageCatalog) {
			if (id in req.messageCatalog) {
				message = req.messageCatalog[id].message;
			}
			else {
				message = id;
			}
		}
		else {
			message = extension.getMessage(id) || id;
		}

		(converter[id] || defaultConverter)(node, message);
	});

	/*
	 * init event handlers
	 */

	el = $('capture');
	if (el) {
		el.addEventListener('click', handleCapture, false);
	}

	el = $('save');
	if (el) {
		el.addEventListener('click', handleOptionsSave, false);
	}

	el = $('opt-init');
	if (el) {
		el.addEventListener('click', handleOptionsInit, false);
	}

	/*
	 * transition
	 */

	var overlay = $('overlay');
	var tend = function (e) {
		e.target.parentNode && e.target.parentNode.removeChild(e.target);
	};

	'transitionend webkitTransitionEnd oTransitionEnd msTransitionEnd'
	.split(' ')
	.forEach(function (p) {overlay.addEventListener(p, tend, false)});

	overlay.className = 'overlay';
}

/**
 * capture button handler
 * ----------------
 */

function handleKeydown (e) {
	if (e.shiftKey && e.keyCode == 16 || e.ctrlKey && e.keyCode == 17) {
		var codes = [];
		e.shiftKey && codes.push('s');
		e.ctrlKey && codes.push('c');
		$('capture-wait').textContent =
			$('capture-wait-buffer').textContent +
			' <' + codes.join('-') + '- >';
		return;
	}

	e.preventDefault();
	$('capture').disabled = true;
	extension.postMessage(
		{
			type: 'query-shortcut',
			data: {
				shiftKey: e.shiftKey,
				ctrlKey: e.ctrlKey,
				keyCode: e.keyCode
			}
		},
		function (res) {
			if (res.result) {
				var shortcut = $('shortcut');
				shortcut.value +=
					(shortcut.value.length ? ', ' : '') +
					res.result;
			}

			$('capture').disabled = false;
			$('capture').click();
		}
	);
}

function handleKeyup (e) {
	$('capture-wait').textContent = $('capture-wait-buffer').textContent;
}

function handleCapture (e) {
	if (e.target.classList.contains('wait')) {
		e.target.classList.remove('wait');
		document.body.removeEventListener('keydown', handleKeydown, true);
		document.body.removeEventListener('keyup', handleKeyup, true);

	}
	else {
		e.target.classList.add('wait');
		$('capture-wait').textContent = $('capture-wait-buffer').textContent;
		document.body.addEventListener('keydown', handleKeydown, true);
		document.body.addEventListener('keyup', handleKeyup, true);
	}
}

/**
 * save button handler
 * ----------------
 */

function handleOptionsSave () {
	var items = [];
	var el;

	// exrc
	el = $('exrc');
	if (el && el.nodeName == 'TEXTAREA') {
		items.push({key:'exrc', value:el.value});
	}

	// targets
	(function () {
		var targets = {};
		Array.prototype.forEach.call(
			document.querySelectorAll(
				'#targets-container input[type="checkbox"]'),
			function (node) {
				var re = /^enable\w+/.exec(node.id);
				if (!re) return;

				targets[re[0]] = node.checked;
			}
		);

		items.push({key:'targets', value:targets});
	})();

	// quick activation
	el = document.querySelector('input[name="quick-activation"]:checked');
	if (el) {
		items.push({key:'quickActivation', value:el.value == '1'});
	}

	// shortcut
	el = $('shortcut');
	if (el) {
		items.push({key:'shortcut', value:el.value});
	}

	// font family
	el = $('font-family');
	if (el && el.nodeName == 'INPUT') {
		items.push({key:'fontFamily', value:el.value});
	}

	// sounds
	(function () {
		var sounds = {};
		Array.prototype.forEach.call(
			document.querySelectorAll(
				'#sounds-container input[type="checkbox"]'),
			function (node) {
				var re = /^sound-(\w+)/.exec(node.id);
				if (!re) return;

				sounds[re[1]] = node.checked;
			}
		);

		items.push({key:'sounds', value:sounds});
	})();

	el = $('sound-volume');
	if (el && el.nodeName == 'INPUT') {
		items.push({key:'soundVolume', value:el.value - 0 || 0});
	}

	// fstab
	(function () {
		var fstab = {};
		Array.prototype.forEach.call(
			document.querySelectorAll(
				'#fstab-container input[type="radio"][name="fstab"]'),
			function (node) {
				fstab[node.value] = {enabled: false};

				if (!node.disabled) {
					fstab[node.value].enabled = true;
				}
				if (node.checked) {
					fstab[node.value].isDefault = true;
				}
			}
		);

		items.push({key:'fstab', value:fstab});
	})();

	// log mode
	el = $('log-mode');
	if (el && el.nodeName == 'INPUT') {
		items.push({key:'logMode', value:el.checked});
	}

	/*
	 * post
	 */

	items.length && extension.postMessage(
		{type:'set-storage', items:items},
		function () {
			var saveResult = $('save-result');
			if (saveResult) {
				saveResult.style.visibility = 'visible';
				setTimeout(function () {
					saveResult.style.visibility = '';
				}, 1000 * SAVED_MESSAGE_VISIBLE_SECS);
			}
		}
	);
}

/**
 * reset button handler
 * ----------------
 */

function handleOptionsInit () {
	var message = $('opt-init-confirm').textContent;
	window.confirm(message) && extension.postMessage(
		{type:'reset-options'},
		function () {
			window.location.reload();
		}
	);
}

global.WasaviOptions = {
	get extension () {return extension},
	set extension (v) {extension = v},
	initPage: initPage
};

})(this);

// vim:set ts=4 sw=4 fenc=UTF-8 ff=unix ft=javascript fdm=marker :
