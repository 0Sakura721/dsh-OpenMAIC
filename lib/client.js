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
.lc-openmaic-bar{display:flex;align-items:center;gap:8px;flex:0 0 auto;min-height:32px;
  padding:4px 10px;font-size:12px;line-height:1.4;border-bottom:1px solid rgba(127,127,127,.18);
  box-sizing:border-box;}
.lc-openmaic-bar-title{font-weight:600;margin-right:2px;}
.lc-openmaic-bar-state{opacity:.68;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;}
.lc-openmaic-bar-spacer{flex:1 1 auto;}
.lc-openmaic-frame-wrap{position:relative;flex:1 1 auto;min-height:0;width:100%;display:flex;
  flex-direction:column;overflow:hidden;}
.lc-openmaic-frame-status{position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;
  box-sizing:border-box;background:rgba(20,22,26,.96);color:#e6e6e6;}
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

		function useStyles() {
			react.useEffect(() => {
				try {
					for (const [id, css] of [
						['lc-openmaic-css', CSS],
						['lc-openmaic-host-css', HOST_CSS],
					]) {
						if (document.getElementById(id)) continue;
						const style = document.createElement('style');
						style.id = id;
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
		 * Report the panel's own geometry to the Host once it has been laid out.
		 *
		 * A screenshot cannot distinguish "0px tall", "4px tall" and "positioned off
		 * screen", and every earlier round of this bug lost time to that ambiguity. The
		 * numbers here are what the Host records, so the next question about a blank
		 * panel is answered by measurement instead of inference.
		 */
		function useEffectReport(ref, report) {
			react.useEffect(() => {
				const element = ref.current;
				if (!element) return undefined;
				let sent = false;
				const send = () => {
					if (sent) return;
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
							height: style.height,
							minHeight: style.minHeight,
						};
					};
					sent = true;
					fetch(`${API}/geometry`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({
							host: box(element),
							fill: box(element.querySelector('.lc-openmaic-fill')),
							root: box(element.querySelector('.lc-openmaic-root')),
							bar: box(element.querySelector('.lc-openmaic-bar')),
							frame: box(element.querySelector('iframe')),
							overlay: box(element.querySelector('.lc-openmaic-frame-status')),
							parent: box(element.parentElement),
							viewport: { w: window.innerWidth, h: window.innerHeight },
							...report?.(),
						}),
					}).catch(() => {
						sent = false;
					});
				};
				const timer = setTimeout(send, 1500);
				return () => clearTimeout(timer);
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
		function StatusBar({ copy, snapshot, busy, act, reload }) {
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
			const reload = () => {
				setFrameKey((value) => value + 1);
				read();
			};

			return jsxs('div', {
				className: 'lc-openmaic-root',
				children: [
					jsx.jsx(StatusBar, { copy, snapshot, busy, act, reload }),
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
		 * The framed classroom, with its own failure reporting.
		 *
		 * A white rectangle is indistinguishable from a page that never loaded, and
		 * that ambiguity has already cost several rounds. This reports what can be
		 * observed from the parent: whether the `load` event fired, and how long it
		 * has been waiting. The retry clears state and remounts the frame.
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
					if (seconds >= 20) setFailed(true);
				}, 1000);

				// Ask the Host, not the app: the app sends no CORS headers, so a fetc
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
						// Only the permission this app actually uses. Listing device
						// permissions here would ask the embedder for capabilities it never
						// grants, which some Chromium builds surface as a policy refusal.
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
