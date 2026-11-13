window.__ModuleLoader__.load({
	id: 'dsh-openmaic',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		const react = require('react');
		const jsx = require('react/jsx-runtime');
		const jsxs = jsx.jsxs ?? jsx.jsx;

		const TOOL_NAME = 'openmaic_render';
		const MIN_HEIGHT = 240;
		const HEIGHT_CAP = 1600;

		/**
		 * CDN origins a card may load static assets from.
		 *
		 * The frame has no network access beyond this list, so a card that points at
		 * an unlisted host fails silently. Keeping the list here (not only in the
		 * prompt) means the CSP and the documentation cannot drift apart.
		 */
		const RESOURCE_ORIGINS = [
			'https://cdnjs.cloudflare.com',
			'https://cdn.jsdelivr.net',
			'https://esm.sh',
			'https://fonts.bunny.net',
			'https://fonts.googleapis.com',
			'https://fonts.gstatic.com',
			'https://unpkg.com',
		];

		const RESOURCE_SOURCES = ['blob:', 'data:', ...RESOURCE_ORIGINS].join(' ');

		/**
		 * The card document's Content-Security-Policy.
		 *
		 * `connect-src` deliberately omits every network origin: a teaching card is a
		 * self-contained artifact, and a card that tried to call an API would look
		 * broken with no explanation. Inline script and style are allowed because the
		 * whole point is an interactive fragment.
		 */
		const FRAME_CSP = [
			"default-src 'none'",
			`script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${RESOURCE_SOURCES}`,
			`style-src 'unsafe-inline' ${RESOURCE_SOURCES}`,
			`img-src ${RESOURCE_SOURCES}`,
			`font-src ${RESOURCE_SOURCES}`,
			`media-src ${RESOURCE_SOURCES}`,
			'worker-src blob:',
			'connect-src blob: data:',
			"frame-src 'none'",
			"object-src 'none'",
			"base-uri 'none'",
			"form-action 'none'",
		].join('; ');

		/** Frame → card height report. */
		const HEIGHT_MESSAGE_TYPE = 'dsh-openmaic:height';

		/** Escape text for interpolation into HTML. */
		function escapeHtml(text) {
			return String(text)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		}

		/**
		 * Assemble the frame document.
		 *
		 * The host page cannot style an opaque-origin frame, so the palette is bridged
		 * in as CSS custom properties and the fragment is dropped into a shell that
		 * already knows how to fill the frame. The height reporter lets the card grow
		 * with its content instead of guessing a fixed size.
		 */
		function buildFrameDoc({ fragment, title, token, dark }) {
			return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">
<style>
  :root{color-scheme:${dark ? 'dark' : 'light'};--lc-bg:${dark ? '#16181d' : '#ffffff'};
    --lc-fg:${dark ? '#e8eaed' : '#1a1d21'};--lc-muted:${dark ? 'rgba(232,234,237,.62)' : 'rgba(26,29,33,.6)'};
    --lc-border:${dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)'};
    --lc-accent:#4f8ef7;}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--lc-bg);color:var(--lc-fg);
    font:14px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;}
  body{padding:12px 14px;}
  img,svg,canvas,video{max-width:100%}
  pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
  pre{overflow:auto;padding:10px 12px;border-radius:8px;background:${dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)'}}
  table{border-collapse:collapse;max-width:100%}
  th,td{border:1px solid var(--lc-border);padding:4px 8px;text-align:left}
  a{color:var(--lc-accent)}
  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-thumb{background:var(--lc-border);border-radius:4px}
</style>
<title>${escapeHtml(title)}</title>
</head><body>
${fragment}
<script>
(function(){
  var token = ${JSON.stringify(token)};
  function report(){
    var h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    try {
      parent.postMessage({ type: ${JSON.stringify(HEIGHT_MESSAGE_TYPE)}, token: token, height: h }, '*');
    } catch (e) {}
  }
  // Report after first paint, on load, and whenever the card's content changes —
  // a simulation that grows a canvas is exactly the case a one-shot measurement
  // gets wrong.
  requestAnimationFrame(report);
  window.addEventListener('load', report);
  try {
    new ResizeObserver(report).observe(document.body);
  } catch (e) {}
})();
<\/script>
</body></html>`;
		}

		/** Read the card payload out of a tool result's meta. */
		function readCard(props) {
			const meta =
				props?.result?.meta ??
				props?.meta ??
				props?.toolResult?.meta ??
				null;
			if (meta && typeof meta === 'object') {
				const fragment = typeof meta.fragment === 'string' ? meta.fragment : null;
				if (fragment !== null) {
					return {
						fragment,
						title: typeof meta.title === 'string' ? meta.title : 'OpenMAIC 课堂',
					};
				}
			}
			// Some hosts project the tool's own output object onto the node.
			const value = props?.result?.value ?? props?.value ?? null;
			if (value && typeof value === 'object' && typeof value.fragment === 'string') {
				return {
					fragment: value.fragment,
					title: typeof value.title === 'string' ? value.title : 'OpenMAIC 课堂',
				};
			}
			return null;
		}

		/** A compact dark/light probe that does not subscribe to the theme store. */
		function useIsDark() {
			const [dark, setDark] = react.useState(() => {
				try {
					return window.matchMedia('(prefers-color-scheme: dark)').matches;
				} catch {
					return false;
				}
			});
			react.useEffect(() => {
				try {
					const query = window.matchMedia('(prefers-color-scheme: dark)');
					const onChange = (event) => setDark(event.matches);
					query.addEventListener('change', onChange);
					return () => query.removeEventListener('change', onChange);
				} catch {
					return undefined;
				}
			}, []);
			return dark;
		}

		const frameStyle = {
			display: 'block',
			width: '100%',
			border: 0,
			background: 'transparent',
			colorScheme: 'normal',
		};

		const headerStyle = {
			display: 'flex',
			alignItems: 'baseline',
			gap: 8,
			fontSize: 12,
			opacity: 0.65,
			margin: '2px 0 6px',
			overflow: 'hidden',
			whiteSpace: 'nowrap',
		};

		/**
		 * The teaching card.
		 *
		 * `sandbox="allow-scripts"` without `allow-same-origin` keeps the card in an
		 * opaque origin: it cannot read the Harness page, its storage, or its cookies.
		 * That is the whole security model, and it is why the card must be
		 * self-contained.
		 */
		function TeachingCard(props) {
			const card = readCard(props);
			const dark = useIsDark();
			const [height, setHeight] = react.useState(MIN_HEIGHT);
			const [expanded, setExpanded] = react.useState(false);

			const token = react.useMemo(
				() => `card-${Math.random().toString(36).slice(2, 10)}`,
				[],
			);

			react.useEffect(() => {
				const onMessage = (event) => {
					const data = event.data;
					if (!data || typeof data !== 'object') return;
					if (data.type !== HEIGHT_MESSAGE_TYPE) return;
					if (data.token !== token) return;
					const next = Number(data.height);
					if (!Number.isFinite(next) || next <= 0) return;
					setHeight(Math.min(HEIGHT_CAP, Math.max(MIN_HEIGHT, Math.ceil(next) + 2)));
				};
				window.addEventListener('message', onMessage);
				return () => window.removeEventListener('message', onMessage);
			}, [token]);

			if (card === null) {
				return jsx.jsx('div', {
					style: { fontSize: 12, opacity: 0.65 },
					children: '这张卡片没有内容。',
				});
			}

			const srcDoc = react.useMemo(
				() => buildFrameDoc({ fragment: card.fragment, title: card.title, token, dark }),
				[card.fragment, card.title, token, dark],
			);

			const frame = (style) =>
				jsx.jsx('iframe', {
					// `sandbox` grants script execution and nothing else: no same-origin
					// access, no forms, no top-level navigation.
					sandbox: 'allow-scripts',
					title: card.title,
					srcDoc,
					style,
				});

			return jsxs('div', {
				children: [
					jsxs('div', {
						style: headerStyle,
						children: [
							jsx.jsx('span', { children: card.title }),
							jsx.jsx('button', {
								style: {
									appearance: 'none',
									marginLeft: 'auto',
									border: '1px solid var(--dsw-alias-border-l2, rgba(0 0 0 / 15%))',
									borderRadius: 6,
									padding: '1px 8px',
									background: 'transparent',
									color: 'inherit',
									fontSize: 12,
									cursor: 'pointer',
								},
								onClick: () => setExpanded(true),
								children: '放大',
							}),
						],
					}),
					frame({ ...frameStyle, height }),
					expanded
						? jsxs('div', {
								style: {
									position: 'fixed',
									inset: 0,
									zIndex: 1000,
									display: 'flex',
									flexDirection: 'column',
									background: 'var(--dsw-alias-bg-layer-1, rgba(13 13 13 / 96%))',
									color: 'var(--dsw-alias-label-primary, inherit)',
								},
								children: [
									jsxs('div', {
										style: {
											display: 'flex',
											alignItems: 'center',
											gap: 8,
											padding: '8px 12px',
											fontSize: 14,
											borderBottom:
												'1px solid var(--dsw-alias-border-l2, rgba(255 255 255 / 12%))',
										},
										children: [
											jsx.jsx('span', { children: card.title }),
											jsx.jsx('button', {
												style: {
													appearance: 'none',
													marginLeft: 'auto',
													border: '1px solid var(--dsw-alias-border-l2, rgba(255 255 255 / 15%))',
													borderRadius: 6,
													padding: '2px 10px',
													background: 'transparent',
													color: 'inherit',
													fontSize: 13,
													cursor: 'pointer',
												},
												onClick: () => setExpanded(false),
												children: '关闭',
											}),
										],
									}),
									frame({ flex: 1, width: '100%', border: 0, background: 'transparent' }),
								],
							})
						: null,
				],
			});
		}

		/**
		 * Register the card under the tool's wire name.
		 *
		 * `slots.inject` waits for the hole's declaration: entry application order is
		 * loader-driven, and a direct `register` racing the declaration fails boot.
		 * That is exactly the mistake that took the whole Web UI down before, so the
		 * inject wrapper is not optional.
		 */
		function apply(ctx) {
			const slots = ctx.get('slots');
			if (!slots) return;

			ctx.slots.inject('tool.call.toolview', () =>
				ctx.slots.register(
					{ name: 'tool.call.toolview', key: TOOL_NAME },
					TeachingCard,
				),
			);
		}

		exports.apply = apply;
		exports.inject = ['slots'];
		exports.name = 'dsh-openmaic-client';
		return module.exports;
	},
});
