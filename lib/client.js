window.__ModuleLoader__.load({
	id: 'dsh-openmaic',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const react = require('react');
		const jsx = require('react/jsx-runtime');

		const PACKAGE_ID = 'dsh-openmaic';
		const API = '/api/dsh-openmaic';
		const SLOT_PANEL = 'sidebar.panellist';
		const SLOT_MAIN = 'main';

		/**
		 * Build marker for this browser bundle.
		 *
		 * The client bundle is served under an immutable cache keyed by file mtime,
		 * so a window that kept an older copy keeps running older code even after a
		 * full Harness restart. Every geometry sample carries this string, which turns
		 * "is the browser on the new build" from an assumption into a fact.
		 */
		const BUILD_MARK = 'frame-inset-1';

		/** Children always arrive as an array here, so use `jsxs`. */
		const jsxs = jsx.jsxs ?? jsx.jsx;

		/* ---------------------------------------------------------------- i18n */

		const COPY = {
			zh: {
				navLabel: '课堂',
				pageTitle: 'OpenMAIC 课堂',
				starting: '正在启动本地课堂服务…',
				stoppedTitle: '本地课堂未运行',
				stoppedBody: '启动会在本机拉起内嵌 PostgreSQL 与 OpenMAIC 服务，首次启动可能需要几十秒。',
				start: '启动',
				stop: '停止',
				restart: '重启',
				recompose: '刷新视图',
				recomposeHint: '强制重建嵌入画布（适用于嵌入内容显示空白）',
				retry: '重试',
				reload: '刷新面板',
				openNewTab: '新标签页打开',
				failed: '启动失败',
				stateRunning: '运行中',
				stateStarting: '启动中',
				stateStopping: '停止中',
				stateStopped: '未运行',
				stateFailed: '失败',
				settingsTitle: 'OpenMAIC 本地课堂',
				settingsBody:
					'把 THU-MAIC/OpenMAIC 变成 Harness 里的一等公民：内嵌数据库、随机的本地端口、无需联网的课堂入口。',
				allowLocalTitle: '允许本地 / 内网模型地址',
				allowLocalBody:
					'打开后，OpenMAIC 允许把模型、语音、图片等提供方指向私有网段或本机地址（含 split-horizon DNS）。对应 OpenMAIC 的 ALLOW_LOCAL_NETWORKS。保存后会重启课堂服务，课程数据不受影响。',
				allowLocalPending: '已保存，重启后生效',
				allowLocalApplied: '已生效',
				allowLocalBlocked:
					'云端元数据地址（169.254.169.254 等）始终被拒绝，这个开关不会放开它们。',
				saving: '保存中…',
				loadingState: '正在读取设置…',
				frameLoading: '正在加载课堂界面…',
				frameStalled: '课堂界面长时间没有响应，可能是内嵌被拦截或服务卡住了。',
				frameServiceOk: '服务可达',
				frameServiceDown: '服务不可达',
				database: '数据库',
				embedded: '内嵌 PostgreSQL',
				external: '外部 PostgreSQL',
				origin: '访问地址',
				pid: '进程号',
				none: '—',
				buildMissing: '缺少生产构建',
				buildMissingBody:
					'检出目录没有 .next 构建产物。在插件仓库运行 node scripts/setup-openmaic.mjs 完成安装与构建。',
				checkoutMissing: '缺少 OpenMAIC 检出',
				checkoutMissingBody:
					'没有找到 OpenMAIC 源码目录。运行 node scripts/setup-openmaic.mjs，或在插件配置里设置 appDir。',
				renderError: '面板渲染失败',
			},
			en: {
				navLabel: 'Classroom',
				pageTitle: 'OpenMAIC classroom',
				starting: 'Starting the local classroom service…',
				stoppedTitle: 'The local classroom is not running',
				stoppedBody:
					'Starting it brings up an embedded PostgreSQL and the OpenMAIC server on this machine. The first start can take a while.',
				start: 'Start',
				stop: 'Stop',
				restart: 'Restart',
				recompose: 'Recompose',
				recomposeHint: 'Force-rebuild the embedded canvas (use when the embed shows blank)',
				retry: 'Retry',
				reload: 'Reload panel',
				openNewTab: 'Open in a new tab',
				failed: 'Start failed',
				stateRunning: 'running',
				stateStarting: 'starting',
				stateStopping: 'stopping',
				stateStopped: 'stopped',
				stateFailed: 'failed',
				settingsTitle: 'OpenMAIC local classroom',
				settingsBody:
					'THU-MAIC/OpenMAIC as a first-class Harness surface: embedded database, random local ports, no cloud dependency for the classroom entry point.',
				allowLocalTitle: 'Allow local / private-network model URLs',
				allowLocalBody:
					'When on, OpenMAIC may point model, speech and image providers at private ranges or this machine (including split-horizon DNS). This is OpenMAIC\u2019s ALLOW_LOCAL_NETWORKS. Saving restarts the classroom server; course data is untouched.',
				allowLocalPending: 'Saved — applies after the restart',
				allowLocalApplied: 'In effect',
				allowLocalBlocked:
					'Cloud metadata addresses (169.254.169.254 and friends) stay refused; this switch never opens them.',
				saving: 'Saving…',
				loadingState: 'Reading settings…',
				frameLoading: 'Loading the classroom…',
				frameStalled: 'The classroom has not responded. The embed may be blocked, or the server may be stuck.',
				frameServiceOk: 'service reachable',
				frameServiceDown: 'service unreachable',
				database: 'Database',
				embedded: 'embedded PostgreSQL',
				external: 'external PostgreSQL',
				origin: 'Origin',
				pid: 'PID',
				none: '—',
				buildMissing: 'No production build',
				buildMissingBody:
					'The checkout has no .next output. Run node scripts/setup-openmaic.mjs from the plugin repository.',
				checkoutMissing: 'No OpenMAIC checkout',
				checkoutMissingBody:
					'No OpenMAIC source directory was found. Run node scripts/setup-openmaic.mjs, or set appDir in the plugin config.',
				renderError: 'The panel failed to render',
			},
		};

		function detectLocale() {
			try {
				const lang = document.documentElement.lang || navigator.language || 'en';
				return String(lang).toLowerCase().startsWith('zh') ? 'zh' : 'en';
			} catch {
				return 'en';
			}
		}

		function useCopy() {
			const [locale, setLocale] = react.useState(detectLocale);
			react.useEffect(() => {
				try {
					const observer = new MutationObserver(() => setLocale(detectLocale()));
					observer.observe(document.documentElement, {
						attributes: true,
						attributeFilter: ['lang'],
					});
					return () => observer.disconnect();
				} catch {
					return undefined;
				}
			}, []);
			return COPY[locale] ?? COPY.en;
		}

		/* ------------------------------------------------------------- styles */

		const CSS = `
.lc-openmaic-root{position:absolute;inset:0;display:flex;flex-direction:column;
  width:100%;height:100%;min-height:0;box-sizing:border-box;overflow:hidden;background:transparent;}
.lc-openmaic-bar{position:absolute;top:0;left:0;right:0;z-index:1;display:flex;align-items:center;
  gap:8px;height:35px;padding:0 10px;font-size:12px;line-height:1.4;
  border-bottom:1px solid rgba(127,127,127,.18);box-sizing:border-box;}
.lc-openmaic-bar-title{font-weight:600;margin-right:2px;}
.lc-openmaic-bar-state{opacity:.68;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;}
.lc-openmaic-bar-spacer{flex:1 1 auto;}
/* The wrapper takes the whole box and the bar floats above it as a strip. A
   percentage height inside a flex column only resolves when the parent has a
   definite height; the shell's chain does not guarantee one, and an iframe whose
   percentage resolves to auto falls back to its 150px replaced-element default —
   which is exactly the thin white strip this replaced. */
.lc-openmaic-frame-wrap{position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:auto;
  display:flex;flex-direction:column;overflow:hidden;padding-top:35px;box-sizing:border-box;}
.lc-openmaic-frame-status{position:absolute;top:35px;left:0;right:0;bottom:0;display:flex;
  flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;
  text-align:center;box-sizing:border-box;background:rgba(20,22,26,.96);color:#e6e6e6;}
.lc-openmaic-frame{flex:1 1 auto;min-height:0;width:100%;border:0;display:block;background:#fff;}
.lc-openmaic-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  flex:1 1 auto;min-height:0;padding:32px;text-align:center;box-sizing:border-box;overflow:auto;}
.lc-openmaic-card-title{font-size:13px;font-weight:600;margin:0;}
.lc-openmaic-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}
.lc-openmaic-title{font-size:15px;font-weight:600;margin:0;}
.lc-openmaic-body{font-size:13px;line-height:1.6;max-width:520px;margin:0;opacity:.72;}
.lc-openmaic-error{font-size:12px;line-height:1.5;max-width:620px;margin:0;padding:10px 12px;border-radius:8px;
  background:rgba(220,80,80,.10);color:#c0392b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  word-break:break-word;white-space:pre-wrap;text-align:left;max-height:40vh;overflow:auto;}
.lc-openmaic-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;align-items:center;}
.lc-openmaic-btn{font:inherit;font-size:12px;padding:4px 11px;border-radius:7px;cursor:pointer;
  border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;white-space:nowrap;}
.lc-openmaic-btn:hover:not(:disabled){background:rgba(127,127,127,.12);}
.lc-openmaic-btn:disabled{opacity:.45;cursor:default;}
.lc-openmaic-btn--primary{border-color:transparent;background:#4f8ef7;color:#fff;}
.lc-openmaic-btn--primary:hover:not(:disabled){background:#3d7de6;}
.lc-openmaic-spinner{width:22px;height:22px;border-radius:50%;border:2px solid rgba(127,127,127,.28);
  border-top-color:#4f8ef7;animation:lc-openmaic-spin .8s linear infinite;}
@keyframes lc-openmaic-spin{to{transform:rotate(360deg)}}
.lc-openmaic-card{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:12px;
  border:1px solid rgba(127,127,127,.22);box-sizing:border-box;}
.lc-openmaic-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:12px;opacity:.85;margin:0;}
.lc-openmaic-kv dt{opacity:.6;}
.lc-openmaic-kv dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;}
.lc-openmaic-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;
  vertical-align:middle;flex:0 0 auto;}
.lc-openmaic-switch{display:flex;align-items:flex-start;gap:10px;cursor:pointer;user-select:none;}
.lc-openmaic-switch input{margin:2px 0 0;flex:0 0 auto;width:16px;height:16px;cursor:pointer;}
.lc-openmaic-switch-text{display:flex;flex-direction:column;gap:3px;}
.lc-openmaic-switch-label{font-size:13px;font-weight:600;}
.lc-openmaic-hint{font-size:11px;opacity:.66;line-height:1.5;}
.lc-openmaic-hint--warn{color:#b9770e;opacity:.95;}
`;

		/**
		 * The panel host.
		 *
		 * The shell's `.mainPanel` is `display:flex; flex-direction:column; flex:1;
		 * min-height:0`, so this host receives a real height (measured 719px inside a
		 * 767px column). Anchoring the panel to that box with `inset:0` is therefore
		 * enough, and nothing here depends on a `useEffect` having run — two earlier
		 * versions wrote a measured pixel height and both collapsed to zero whenever
		 * that measurement was late or absent.
		 */
		const HOST_CSS = `
.lc-openmaic-host{position:relative;display:block;flex:1 1 auto;min-width:0;min-height:0;
  width:100%;height:100%;box-sizing:border-box;overflow:hidden;}
.lc-openmaic-fill{position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;
  box-sizing:border-box;min-height:0;}
`;

		/**
		 * Install the stylesheets, replacing any previous copy.
		 *
		 * The earlier version skipped an id that already existed, which meant an
		 * already-installed stylesheet from an older build survived every reload and
		 * silently shadowed the new rules — the panel kept rendering with CSS that had
		 * been superseded on disk. Each stylesheet is now keyed by BUILD_MARK and any
		 * stale node is removed, so what runs is always what shipped.
		 */
		function useStyles() {
			react.useEffect(() => {
				try {
					for (const [id, css] of [
						['lc-openmaic-css', CSS],
						['lc-openmaic-host-css', HOST_CSS],
					]) {
						const versioned = `${id}-${BUILD_MARK}`;
						for (const stale of document.querySelectorAll(`[data-lc-openmaic="${id}"]`)) {
							if (stale.id !== versioned) stale.remove();
						}
						if (document.getElementById(versioned)) continue;
						const style = document.createElement('style');
						style.id = versioned;
						style.setAttribute('data-lc-openmaic', id);
						style.textContent = css;
						document.head.appendChild(style);
					}
				} catch {}
				return undefined;
			}, []);
		}

		/* -------------------------------------------------------------- state */

		function useOpenMaic() {
			const [snapshot, setSnapshot] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);

			const read = react.useCallback(async () => {
				try {
					const response = await fetch(`${API}/status`, {
						headers: { accept: 'application/json' },
						credentials: 'same-origin',
					});
					if (!response.ok) throw new Error(`status ${response.status}`);
					const body = await response.json();
					setSnapshot(body);
					setError(null);
					return body;
				} catch (failure) {
					setError(String(failure?.message ?? failure));
					return null;
				}
			}, []);

			react.useEffect(() => {
				let alive = true;
				let timer;
				const tick = async () => {
					const body = await read();
					if (!alive) return;
					const pending = body && (body.phase === 'starting' || body.phase === 'stopping');
					timer = setTimeout(tick, pending ? 1200 : 5000);
				};
				tick();
				return () => {
					alive = false;
					clearTimeout(timer);
				};
			}, [read]);

			const act = react.useCallback(async (action) => {
				setBusy(true);
				setError(null);
				try {
					const response = await fetch(`${API}/${action}`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						credentials: 'same-origin',
						body: '{}',
					});
					const body = await response.json().catch(() => null);
					if (body) setSnapshot(body);
					if (body?.error) setError(body.error);
				} catch (failure) {
					setError(String(failure?.message ?? failure));
				} finally {
					setBusy(false);
				}
			}, []);

			return { snapshot, busy, error, act, read, setSnapshot, setError, setBusy };
		}

		/* ----------------------------------------------------------- components */

		/**
		 * A host box that reports its own size, so the panel never depends on an
		 * ancestor's height chain. Falls back to the viewport when an ancestor
		 * reports nothing, which keeps the panel usable even in a zero-height slot.
		 */
		/**
		 * The panel host — pure CSS, no measurement.
		 *
		 * Earlier versions measured the box in a `useEffect` and wrote a pixel height,
		 * which produced a blank panel twice: a measurement that had not run yet left
		 * an absolutely positioned child with no height. The shell's `.mainPanel` is
		 * `display:flex; flex-direction:column; flex:1; min-height:0` and does give this
		 * host a real box, so `height:100%` plus an `inset:0` child is enough and has
		 * no runtime dependency at all.
		 */
		/**
		 * Report the panel's own geometry to the Host.
		 *
		 * A screenshot cannot distinguish "0px tall", "4px tall" and "positioned off
		 * screen", and every earlier round of this bug lost time to that ambiguity.
		 *
		 * It samples repeatedly instead of once: the first version measured a single
		 * time at 1.5s, which landed before the status fetch had resolved, so it
		 * reported a null iframe from the not-yet-running branch and sent the
		 * investigation down the wrong path. Each sample carries a sequence number so a
		 * later, more complete one is not mistaken for a different failure.
		 */
		function useEffectReport(ref, report) {
			react.useEffect(() => {
				const element = ref.current;
				if (!element) return undefined;

				const box = (node) => {
					if (!node) return null;
					const rect = node.getBoundingClientRect();
					const style = getComputedStyle(node);
					return {
						w: Math.round(rect.width),
						h: Math.round(rect.height),
						top: Math.round(rect.top),
						left: Math.round(rect.left),
						display: style.display,
						position: style.position,
						height: style.height,
						flex: style.flex,
						paddingTop: style.paddingTop,
						minHeight: style.minHeight,
					};
				};

				// Whether the stylesheet is actually in the document decides between
				// "the rule is wrong" and "the rule never arrived"; both look identical
				// from a screenshot.
				const styles = ['lc-openmaic-css', 'lc-openmaic-host-css'].map((key) => {
					const node = document.querySelector(`[data-lc-openmaic="${key}"]`);
					return {
						key,
						present: node !== null,
						id: node ? node.id : null,
						bytes: node ? node.textContent.length : 0,
					};
				});
				const probeFrame = element.querySelector('iframe');
				const probeWrap = element.querySelector('.lc-openmaic-frame-wrap');
				const frameRuleApplies = probeFrame
					? getComputedStyle(probeFrame).display === 'block'
					: false;
				const wrapRuleApplies = probeWrap
					? getComputedStyle(probeWrap).position === 'absolute'
					: false;

				let seq = 0;
				const send = () => {
					seq += 1;
					const rootEl = element.querySelector('.lc-openmaic-root');
					const frame = element.querySelector('iframe');
					const payload = {
						seq,
						host: box(element),
						fill: box(element.querySelector('.lc-openmaic-fill')),
						root: box(rootEl),
						bar: box(element.querySelector('.lc-openmaic-bar')),
						frame: box(frame),
						overlay: box(element.querySelector('.lc-openmaic-frame-status')),
						parent: box(element.parentElement),
						viewport: { w: window.innerWidth, h: window.innerHeight },
						styles,
						frameRuleApplies,
						wrapRuleApplies,
						buildMark: BUILD_MARK,
						// What is actually mounted, so a missing frame is explained rather
						// than guessed at.
						dom: rootEl
							? [...rootEl.children].map((child) => ({
									tag: child.tagName.toLowerCase(),
									cls: typeof child.className === 'string' ? child.className : '',
								}))
							: null,
						frameSrc: frame ? frame.getAttribute('src') : null,
						...report?.(),
					};
					fetch(`${API}/geometry`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(payload),
					}).catch(() => {});
				};

				const first = setTimeout(send, 800);
				const second = setTimeout(send, 3000);
				const third = setTimeout(send, 8000);
				return () => {
					clearTimeout(first);
					clearTimeout(second);
					clearTimeout(third);
				};
			}, []);
		}

		function PanelHost({ children, report }) {
			const ref = react.useRef(null);
			useEffectReport(ref, report);
			return jsx.jsx('div', {
				ref,
				className: 'lc-openmaic-host',
				children: jsx.jsx('div', { className: 'lc-openmaic-fill', children }),
			});
		}

		function PanelIcon({ size }) {
			const edge = typeof size === 'number' && size > 0 ? size : 16;
			return jsxs('svg', {
				xmlns: 'http://www.w3.org/2000/svg',
				viewBox: '0 0 24 24',
				width: edge,
				height: edge,
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 1.6,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
				'aria-hidden': 'true',
				focusable: 'false',
				children: [
					jsx.jsx('path', { d: 'M3 5.5h18v10H3z' }),
					jsx.jsx('path', { d: 'M8 19h8M12 15.5V19' }),
					jsx.jsx('path', { d: 'M7 9h5M7 12h3' }),
					jsx.jsx('circle', { cx: 16.5, cy: 10.5, r: 1.4 }),
				],
			});
		}

		function stateLabel(copy, phase) {
			if (phase === 'running') return copy.stateRunning;
			if (phase === 'starting') return copy.stateStarting;
			if (phase === 'stopping') return copy.stateStopping;
			if (phase === 'failed') return copy.stateFailed;
			return copy.stateStopped;
		}

		/** A thin strip that is always visible, so the panel is never a blank area. */
		function StatusBar({ copy, snapshot, busy, act, reload, onRecompose }) {
			const phase = snapshot?.phase ?? 'stopped';
			const running = phase === 'running';
			return jsxs('div', {
				className: 'lc-openmaic-bar',
				children: [
					jsx.jsx('span', {
						className: 'lc-openmaic-dot',
						style: {
							background: running
								? '#3ba55d'
								: phase === 'failed'
									? '#c0392b'
									: 'rgba(127,127,127,.6)',
						},
					}),
					jsx.jsx('span', { className: 'lc-openmaic-bar-title', children: copy.pageTitle }),
					jsx.jsx('span', {
						className: 'lc-openmaic-bar-state',
						children: stateLabel(copy, phase),
					}),
					jsx.jsx('span', { className: 'lc-openmaic-bar-spacer' }),
					jsx.jsx('button', {
						className: 'lc-openmaic-btn',
						disabled: busy || phase === 'starting' || phase === 'stopping',
						onClick: () => act(running ? 'stop' : 'start'),
						children: running ? copy.stop : copy.start,
					}),
					jsx.jsx('button', {
						className: 'lc-openmaic-btn',
						disabled: busy || !running,
						onClick: () => act('restart'),
						children: copy.restart,
					}),
					jsx.jsx('button', {
						className: 'lc-openmaic-btn',
						title: copy.recomposeHint,
						onClick: onRecompose,
						children: copy.recompose,
					}),
					jsx.jsx('button', {
						className: 'lc-openmaic-btn',
						onClick: reload,
						children: copy.reload,
					}),
				],
			});
		}

		function StatusCard({ snapshot, copy }) {
			if (!snapshot) return null;
			const db =
				snapshot.dbManaged === true
					? `${copy.embedded}${snapshot.dbVersion ? ` ${snapshot.dbVersion}` : ''}`
					: snapshot.dbUrl
						? copy.external
						: copy.none;
			return jsx.jsx('div', {
				className: 'lc-openmaic-card',
				children: jsxs('dl', {
					className: 'lc-openmaic-kv',
					children: [
						jsx.jsx('dt', { children: copy.origin }),
						jsx.jsx('dd', { children: snapshot.panelOrigin ?? copy.none }),
						jsx.jsx('dt', { children: copy.database }),
						jsx.jsx('dd', { children: db }),
						jsx.jsx('dt', { children: copy.pid }),
						jsx.jsx('dd', { children: snapshot.pid ?? copy.none }),
					],
				}),
			});
		}

		function PresetBody({ copy, snapshot, error, busy, act }) {
			const phase = snapshot?.phase ?? 'stopped';
			const missingCheckout = snapshot && snapshot.appDir && snapshot.appManifest === null;
			const missingBuild = snapshot && snapshot.appManifest !== null && snapshot.hasBuild === false;
			const origin = snapshot?.panelOrigin ?? null;
			const message = error ?? snapshot?.error ?? null;

			if (phase === 'starting' || phase === 'stopping') {
				return jsxs('div', {
					className: 'lc-openmaic-center',
					children: [
						jsx.jsx('div', { className: 'lc-openmaic-spinner' }),
						jsx.jsx('p', { className: 'lc-openmaic-body', children: copy.starting }),
						message
							? jsx.jsx('pre', { className: 'lc-openmaic-error', children: message })
							: null,
					],
				});
			}

			return jsxs('div', {
				className: 'lc-openmaic-center',
				children: [
					jsx.jsx('h2', {
						className: 'lc-openmaic-title',
						children: missingCheckout
							? copy.checkoutMissing
							: missingBuild
								? copy.buildMissing
								: phase === 'failed'
									? copy.failed
									: copy.stoppedTitle,
					}),
					jsx.jsx('p', {
						className: 'lc-openmaic-body',
						children: missingCheckout
							? copy.checkoutMissingBody
							: missingBuild
								? copy.buildMissingBody
								: copy.stoppedBody,
					}),
					message ? jsx.jsx('pre', { className: 'lc-openmaic-error', children: message }) : null,
					jsxs('div', {
						className: 'lc-openmaic-row',
						children: [
							jsx.jsx('button', {
								className: 'lc-openmaic-btn lc-openmaic-btn--primary',
								disabled: busy || missingCheckout,
								onClick: () => act('start'),
								children: phase === 'failed' ? copy.retry : copy.start,
							}),
							origin
								? jsx.jsx('a', {
										className: 'lc-openmaic-btn',
										href: origin,
										target: '_blank',
										rel: 'noreferrer',
										children: copy.openNewTab,
									})
								: null,
						],
					}),
				],
			});
		}

		function ClassroomPage() {
			useStyles();
			const copy = useCopy();
			const { snapshot, busy, error, act, read } = useOpenMaic();
			const [frameKey, setFrameKey] = react.useState(0);

			const phase = snapshot?.phase ?? 'stopped';
			const origin = snapshot?.panelOrigin ?? null;
			try {
				window.__lcOpenmaicBranch = `${phase}/${origin ? 'has-origin' : 'no-origin'}/${
					snapshot ? 'has-snapshot' : 'no-snapshot'
				}`;
			} catch {}
			const reload = () => {
				setFrameKey((value) => value + 1);
				read();
			};

			return jsxs('div', {
				className: 'lc-openmaic-root',
				children: [
					jsx.jsx(StatusBar, {
						copy,
						snapshot,
						busy,
						act,
						reload,
						onRecompose: () => {
							setFrameKey((value) => value + 1);
							read();
						},
					}),
					phase === 'running' && origin
						? jsx.jsx(PanelFrame, {
								copy,
								origin,
								frameKey,
								onRetry: reload,
							})
						: jsx.jsx(PresetBody, { copy, snapshot, error, busy, act }),
				],
			});
		}

		function AllowLocalSwitch({ copy, snapshot, onSaved }) {
			const serverValue = snapshot?.settings?.allowLocalNetworks === true;
			const applied = snapshot?.appliedAllowLocalNetworks === true;
			const [checked, setChecked] = react.useState(serverValue);
			const [saving, setSaving] = react.useState(false);
			const [failure, setFailure] = react.useState(null);
			const dirty = checked !== serverValue;

			react.useEffect(() => {
				setChecked(serverValue);
			}, [serverValue]);

			if (!snapshot) {
				return jsx.jsx('div', {
					className: 'lc-openmaic-card',
					children: jsx.jsx('span', { className: 'lc-openmaic-hint', children: copy.loadingState }),
				});
			}

			const commit = async (next) => {
				setSaving(true);
				setFailure(null);
				try {
					const response = await fetch(`${API}/settings`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						credentials: 'same-origin',
						body: JSON.stringify({ allowLocalNetworks: next }),
					});
					const body = await response.json().catch(() => null);
					if (!response.ok || !body) throw new Error(body?.error ?? `status ${response.status}`);
					if (body.snapshot) onSaved(body.snapshot);
					else if (body.error) throw new Error(body.error);
				} catch (error) {
					setFailure(String(error?.message ?? error));
					setChecked(!next);
				} finally {
					setSaving(false);
				}
			};

			const onToggle = () => {
				const next = !checked;
				setChecked(next);
				commit(next);
			};

			return jsxs('div', {
				className: 'lc-openmaic-card',
				children: [
					jsxs('label', {
						className: 'lc-openmaic-switch',
						children: [
							jsx.jsx('input', {
								type: 'checkbox',
								checked,
								disabled: saving,
								onChange: onToggle,
							}),
							jsxs('span', {
								className: 'lc-openmaic-switch-text',
								children: [
									jsx.jsx('span', {
										className: 'lc-openmaic-switch-label',
										children: copy.allowLocalTitle,
									}),
									jsx.jsx('span', {
										className: 'lc-openmaic-hint',
										children: copy.allowLocalBody,
									}),
								],
							}),
						],
					}),
					saving
						? jsx.jsx('span', { className: 'lc-openmaic-hint', children: copy.saving })
						: null,
					dirty && !saving
						? jsx.jsx('span', {
								className: 'lc-openmaic-hint lc-openmaic-hint--warn',
								children: copy.allowLocalPending,
							})
						: null,
					!dirty && checked && applied
						? jsx.jsx('span', {
								className: 'lc-openmaic-hint',
								children: copy.allowLocalApplied,
							})
						: null,
					!dirty && checked && !applied && snapshot?.phase === 'running'
						? jsx.jsx('span', {
								className: 'lc-openmaic-hint lc-openmaic-hint--warn',
								children: copy.allowLocalPending,
							})
						: null,
					jsx.jsx('span', { className: 'lc-openmaic-hint', children: copy.allowLocalBlocked }),
					failure
						? jsx.jsx('pre', { className: 'lc-openmaic-error', children: failure })
						: null,
				],
			});
		}

		function SettingsCard() {
			useStyles();
			const copy = useCopy();
			const { snapshot, setSnapshot } = useOpenMaic();

			return jsxs('div', {
				className: 'lc-openmaic-card',
				children: [
					jsx.jsx('h3', { children: copy.settingsTitle }),
					jsx.jsx('p', { className: 'lc-openmaic-body', children: copy.settingsBody }),
					jsx.jsx(AllowLocalSwitch, {
						copy,
						snapshot,
						onSaved: (next) => setSnapshot(next),
					}),
					jsx.jsx(StatusCard, { snapshot, copy }),
				],
			});
		}

		/**
		 * The framed classroom.
		 *
		 * The frame loads a same-origin prefix (`/openmaic`) served by the Host's
		 * reverse proxy, not a cross-origin port and not srcdoc.
		 *
		 * Both alternatives were tried and both failed differently. A cross-origin
		 * iframe over a WebContentsView can load and compute without ever being painted.
		 * A srcdoc frame paints, but its document lives at `about:srcdoc`, so its origin
		 * is opaque — the app's API calls, cookies, navigation and history all target
		 * the wrong origin and nothing is interactive. A same-origin prefix keeps both
		 * properties at once: the frame is same-origin with the page hosting it, and it
		 * still has a real, addressable origin.
		 */
		function PanelFrame({ copy, origin, frameKey, onRetry }) {
			const [loaded, setLoaded] = react.useState(false);
			const [waited, setWaited] = react.useState(0);
			const [failed, setFailed] = react.useState(false);
			const [reachable, setReachable] = react.useState(null);

			react.useEffect(() => {
				setLoaded(false);
				setFailed(false);
				setWaited(0);
				setReachable(null);
				const started = Date.now();
				const timer = setInterval(() => {
					const seconds = Math.round((Date.now() - started) / 1000);
					setWaited(seconds);
					// A loopback page either answers in a few seconds or never will; the
					// panel says so instead of staying blank.
					if (seconds >= 25) setFailed(true);
				}, 1000);

				// Ask the Host, not the app: the app sends no CORS headers, so a fetch
				// from this origin would fail even when the service is perfectly healthy,
				// and a false "unreachable" is worse than no diagnostic.
				fetch(`${API}/probe`, { headers: { accept: 'application/json' } })
					.then((response) => response.json())
					.then((body) => setReachable({ ok: body?.ok === true, status: body?.status ?? 0 }))
					.catch(() => setReachable(null));

				return () => clearInterval(timer);
			}, [frameKey, origin]);

			const showOverlay = !loaded;

			return jsxs('div', {
				className: 'lc-openmaic-frame-wrap',
				children: [
					jsx.jsx('iframe', {
						key: `frame-${frameKey}`,
						className: 'lc-openmaic-frame',
						src: origin,
						title: copy.pageTitle,
						// The classroom needs its own storage and clipboard to be usable;
						// `allow-same-origin` is deliberately absent so the prefix origin is
						// the real one rather than an opaque sandbox origin.
						allow: 'clipboard-write',
						onLoad: () => {
							setLoaded(true);
							setFailed(false);
						},
						onError: () => setFailed(true),
					}),
					showOverlay
						? jsxs('div', {
								className: 'lc-openmaic-frame-status',
								children: [
									failed
										? jsx.jsx('div', { className: 'lc-openmaic-spinner' })
										: jsx.jsx('div', { className: 'lc-openmaic-spinner' }),
									jsx.jsx('p', {
										className: 'lc-openmaic-body',
										children: failed ? copy.frameStalled : copy.frameLoading,
									}),
									jsx.jsx('p', {
										className: 'lc-openmaic-hint',
										children:
											`${origin} · ${waited}s` +
											(reachable === null
												? ''
												: reachable.ok
													? ` · HTTP ${reachable.status} · ${copy.frameServiceOk}`
													: ` · HTTP ${reachable.status || '—'} · ${copy.frameServiceDown}`),
									}),
									failed
										? jsxs('div', {
												className: 'lc-openmaic-row',
												children: [
													jsx.jsx('button', {
														className: 'lc-openmaic-btn lc-openmaic-btn--primary',
														onClick: onRetry,
														children: copy.reload,
													}),
													jsx.jsx('a', {
														className: 'lc-openmaic-btn',
														href: origin,
														target: '_blank',
														rel: 'noreferrer',
														children: copy.openNewTab,
													}),
												],
											})
										: null,
								],
							})
						: null,
				],
			});
		}


		class PanelBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error };
			}

			componentDidCatch(error) {
				try {
					window.__lcOpenmaicError = String(error?.stack ?? error).slice(0, 800);
					console.error('[dsh-openmaic] panel render failed', error);
				} catch {}
			}

			render() {
				const { error } = this.state;
				if (!error) return this.props.children;
				const copy = this.props.copy ?? COPY.en;
				return jsxs('div', {
					className: 'lc-openmaic-center',
					children: [
						jsx.jsx('h2', { className: 'lc-openmaic-title', children: copy.renderError }),
						jsx.jsx('pre', {
							className: 'lc-openmaic-error',
							children: String(error?.stack ?? error),
						}),
					],
				});
			}
		}

		function Guarded({ component: Component, ...rest }) {
			const copy = useCopy();
			return jsx.jsx(PanelBoundary, {
				copy,
				children: jsx.jsx(Component, rest),
			});
		}

		/* --------------------------------------------------------------- apply */

		function apply(ctx) {
			const slots = ctx.get('slots');
			if (!slots) return;

			ctx.slots.inject(SLOT_PANEL, () =>
				ctx.slots.register(
					{ name: SLOT_PANEL, id: PACKAGE_ID, order: 30, label: () => 'OpenMAIC' },
					PanelIcon,
				),
			);

			ctx.slots.inject(SLOT_MAIN, () =>
				ctx.slots.register(
					{ name: SLOT_MAIN, key: PACKAGE_ID },
					function OpenMaicPanel() {
						return jsx.jsx(PanelHost, {
							report: () => ({
								branch: window.__lcOpenmaicBranch ?? null,
								boundaryError: window.__lcOpenmaicError ?? null,
							}),
							children: jsx.jsx(Guarded, { component: ClassroomPage }),
						});
					},
				),
			);

			ctx.slots.inject('settings.section', () =>
				ctx.slots.register(
					{ name: 'settings.section', id: PACKAGE_ID, order: 460, label: () => 'OpenMAIC' },
					function OpenMaicSettings() {
						return jsx.jsx(Guarded, { component: SettingsCard });
					},
				),
			);
		}

		const inject = ['slots'];

		exports.apply = apply;
		exports.inject = inject;
		exports.name = 'dsh-openmaic-client';
		return module.exports;
	},
});
