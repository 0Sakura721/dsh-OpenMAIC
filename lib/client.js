window.__ModuleLoader__.load({
	id: 'dsh-openmaic',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const react = require('react');
		const jsx = require('react/jsx-runtime');
		const h = react.createElement;

		const PACKAGE_ID = 'dsh-openmaic';
		const API = '/api/dsh-openmaic';
		const SLOT_PANEL = 'sidebar.panellist';
		const SLOT_MAIN = 'main';

		/* ---------------------------------------------------------------- i18n */

		const COPY = {
			zh: {
				navLabel: '课堂',
				pageTitle: 'OpenMAIC 课堂',
				starting: '正在启动本地课堂服务…',
				stoppedTitle: '本地课堂未运行',
				stoppedBody:
					'启动会在本机拉起内嵌 PostgreSQL 与 OpenMAIC 服务，首次启动可能需要几十秒。',
				start: '启动',
				stop: '停止',
				restart: '重启',
				retry: '重试',
				openNewTab: '新标签页打开',
				failed: '启动失败',
				settingsTitle: 'OpenMAIC 本地课堂',
				settingsBody:
					'把 THU-MAIC/OpenMAIC 变成 Harness 里的一等公民：内嵌数据库、随机的本地端口、无需联网的课堂生成入口。',
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
				openNewTab: 'Open in a new tab',
				failed: 'Start failed',
				settingsTitle: 'OpenMAIC local classroom',
				settingsBody:
					'THU-MAIC/OpenMAIC as a first-class Harness surface: embedded database, random local ports, no cloud dependency for the classroom entry point.',
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
				const observer = new MutationObserver(() => setLocale(detectLocale()));
				observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
				return () => observer.disconnect();
			}, []);
			return COPY[locale] ?? COPY.en;
		}

		/* ------------------------------------------------------------- styles */

		const CSS = `
.lc-openmaic-root{display:flex;flex-direction:column;height:100%;min-height:0;width:100%;}
.lc-openmaic-frame{flex:1 1 auto;min-height:0;border:0;width:100%;background:transparent;}
.lc-openmaic-center{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  height:100%;min-height:0;padding:32px;text-align:center;box-sizing:border-box;}
.lc-openmaic-title{font-size:15px;font-weight:600;margin:0;}
.lc-openmaic-body{font-size:13px;line-height:1.6;max-width:520px;margin:0;opacity:.72;}
.lc-openmaic-error{font-size:12px;line-height:1.5;max-width:620px;margin:0;padding:10px 12px;border-radius:8px;
  background:rgba(220,80,80,.10);color:#c0392b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  word-break:break-word;white-space:pre-wrap;text-align:left;}
.lc-openmaic-row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
.lc-openmaic-btn{font:inherit;font-size:13px;padding:6px 14px;border-radius:8px;cursor:pointer;
  border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;}
.lc-openmaic-btn:hover:not(:disabled){background:rgba(127,127,127,.12);}
.lc-openmaic-btn:disabled{opacity:.45;cursor:default;}
.lc-openmaic-btn--primary{border-color:transparent;background:#4f8ef7;color:#fff;}
.lc-openmaic-btn--primary:hover:not(:disabled){background:#3d7de6;}
.lc-openmaic-spinner{width:22px;height:22px;border-radius:50%;border:2px solid rgba(127,127,127,.28);
  border-top-color:#4f8ef7;animation:lc-openmaic-spin .8s linear infinite;}
@keyframes lc-openmaic-spin{to{transform:rotate(360deg)}}
.lc-openmaic-card{display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:12px;
  border:1px solid rgba(127,127,127,.22);}
.lc-openmaic-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:12px;opacity:.85;}
.lc-openmaic-kv dt{opacity:.6;}
.lc-openmaic-kv dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;}
.lc-openmaic-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;}
`;

		function useStyles() {
			react.useEffect(() => {
				if (document.getElementById('lc-openmaic-css')) return;
				const style = document.createElement('style');
				style.id = 'lc-openmaic-css';
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
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

			const act = react.useCallback(
				async (action) => {
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
				},
				[],
			);

			return { snapshot, busy, error, act, read };
		}

		/* ----------------------------------------------------------- components */

		function PanelIcon({ size }) {
			const edge = typeof size === 'number' && size > 0 ? size : 16;
			return jsx.jsx('svg', {
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
					jsx.jsx('path', { key: 'a', d: 'M3 5.5h18v10H3z' }),
					jsx.jsx('path', { key: 'b', d: 'M8 19h8M12 15.5V19' }),
					jsx.jsx('path', { key: 'c', d: 'M7 9h5M7 12h3' }),
					jsx.jsx('circle', { key: 'd', cx: 16.5, cy: 10.5, r: 1.4 }),
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
				children: jsx.jsx('dl', {
					className: 'lc-openmaic-kv',
					children: [
						jsx.jsx('dt', { key: 'p', children: 'state' }),
						jsx.jsx('dd', { key: 'pv', children: snapshot.phase }),
						jsx.jsx('dt', { key: 'd', children: copy.database }),
						jsx.jsx('dd', { key: 'dv', children: db }),
						jsx.jsx('dt', { key: 'o', children: copy.origin }),
						jsx.jsx('dd', { key: 'ov', children: snapshot.panelOrigin ?? copy.none }),
						jsx.jsx('dt', { key: 'i', children: copy.pid }),
						jsx.jsx('dd', { key: 'iv', children: snapshot.pid ?? copy.none }),
					],
				}),
			});
		}

		function ClassroomPage() {
			useStyles();
			const copy = useCopy();
			const { snapshot, busy, error, act } = useOpenMaic();

			const phase = snapshot?.phase ?? 'stopped';
			const origin = snapshot?.panelOrigin ?? null;

			if (phase === 'running' && origin) {
				return jsx.jsx('div', {
					className: 'lc-openmaic-root',
					children: jsx.jsx('iframe', {
						className: 'lc-openmaic-frame',
						src: origin,
						title: copy.pageTitle,
						allow: 'clipboard-read; clipboard-write; microphone; camera',
					}),
				});
			}

			if (phase === 'starting' || phase === 'stopping') {
				return jsx.jsx('div', {
					className: 'lc-openmaic-center',
					children: [
						jsx.jsx('div', { key: 's', className: 'lc-openmaic-spinner' }),
						jsx.jsx('p', { key: 't', className: 'lc-openmaic-body', children: copy.starting }),
					],
				});
			}

			const missingCheckout = snapshot && snapshot.appDir && snapshot.appManifest === null;
			const missingBuild = snapshot && snapshot.appManifest !== null && snapshot.hasBuild === false;

			return jsx.jsx('div', {
				className: 'lc-openmaic-center',
				children: [
					jsx.jsx('h2', {
						key: 't',
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
						key: 'b',
						className: 'lc-openmaic-body',
						children: missingCheckout
							? copy.checkoutMissingBody
							: missingBuild
								? copy.buildMissingBody
								: copy.stoppedBody,
					}),
					error || snapshot?.error
						? jsx.jsx('pre', {
								key: 'e',
								className: 'lc-openmaic-error',
								children: error ?? snapshot.error,
							})
						: null,
					jsx.jsx('div', {
						key: 'r',
						className: 'lc-openmaic-row',
						children: [
							jsx.jsx('button', {
								key: 'start',
								className: 'lc-openmaic-btn lc-openmaic-btn--primary',
								disabled: busy || missingCheckout,
								onClick: () => act('start'),
								children: phase === 'failed' ? copy.retry : copy.start,
							}),
							origin
								? jsx.jsx('a', {
										key: 'open',
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

		function SettingsCard() {
			useStyles();
			const copy = useCopy();
			const { snapshot, busy, error, act } = useOpenMaic();
			const phase = snapshot?.phase ?? 'stopped';
			const running = phase === 'running';

			return jsx.jsx('div', {
				className: 'lc-openmaic-card',
				children: [
					jsx.jsx('p', {
						key: 'b',
						className: 'lc-openmaic-body',
						children: copy.settingsBody,
					}),
					jsx.jsx('p', {
						key: 's',
						className: 'lc-openmaic-body',
						children: [
							jsx.jsx('span', {
								key: 'd',
								className: 'lc-openmaic-dot',
								style: {
									background: running
										? '#3ba55d'
										: phase === 'failed'
											? '#c0392b'
											: 'rgba(127,127,127,.6)',
								},
							}),
							`${phase}${snapshot?.panelOrigin ? ` · ${snapshot.panelOrigin}` : ''}`,
						],
					}),
					error || snapshot?.error
						? jsx.jsx('pre', {
								key: 'e',
								className: 'lc-openmaic-error',
								children: error ?? snapshot.error,
							})
						: null,
					jsx.jsx(StatusCard, { key: 'c', snapshot, copy }),
					jsx.jsx('div', {
						key: 'r',
						className: 'lc-openmaic-row',
						children: [
							jsx.jsx('button', {
								key: 'toggle',
								className: 'lc-openmaic-btn lc-openmaic-btn--primary',
								disabled: busy || phase === 'starting' || phase === 'stopping',
								onClick: () => act(running ? 'stop' : 'start'),
								children: running ? copy.stop : copy.start,
							}),
							jsx.jsx('button', {
								key: 'restart',
								className: 'lc-openmaic-btn',
								disabled: busy || !running,
								onClick: () => act('restart'),
								children: copy.restart,
							}),
						],
					}),
				],
			});
		}

		/* --------------------------------------------------------------- apply */

		function apply(ctx) {
			const slots = ctx.get('slots');
			if (!slots) return;

			// Each registration waits for its slot's declaration lifetime, so a
			// plugin that loads before the shell declares the seat still lands.
			ctx.slots.inject(SLOT_PANEL, () =>
				ctx.slots.register(
					{
						name: SLOT_PANEL,
						id: PACKAGE_ID,
						order: 30,
						label: () => 'OpenMAIC',
					},
					PanelIcon,
				),
			);

			ctx.slots.inject(SLOT_MAIN, () =>
				ctx.slots.register(
					{
						name: SLOT_MAIN,
						key: PACKAGE_ID,
					},
					ClassroomPage,
				),
			);

			ctx.slots.inject('settings.section', () =>
				ctx.slots.register(
					{
						name: 'settings.section',
						id: PACKAGE_ID,
						order: 460,
						label: () => 'OpenMAIC',
					},
					SettingsCard,
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
