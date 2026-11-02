import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import type { FeedMessage } from '@open-announce/contracts';

type PreviewElement = HTMLElement & { messages?: FeedMessage[]; open?: () => void };

/**
 * Shows a message the way a host system will, with the real @openstuff-dev/announce elements
 * (served by the server at /sdk), in a frame so popups and popovers stay inside it.
 */
@Component({
  selector: 'app-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<iframe #frame title="Preview" [srcdoc]="doc"></iframe>`,
  styles: `
    :host {
      display: block;
    }

    iframe {
      display: block;
      inline-size: 100%;
      block-size: 22rem;
      border: 1px var(--os-border-style) var(--os-border-default);
      border-radius: var(--os-radius-md);
      background: var(--os-bg-alternative);
    }
  `,
})
export class Preview {
  readonly message = input.required<FeedMessage>();
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');
  private ready = false;

  // Angular would strip the frame's script and styles. Nothing here comes from a person or the
  // server: it's a constant, and location.origin (scheme, host and port) can't hold markup.
  // eslint-disable-next-line no-restricted-syntax -- a constant page; see above.
  protected readonly doc = inject(DomSanitizer).bypassSecurityTrustHtml(`<!doctype html><html><head><meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<script type="importmap">{ "imports": { "@openstuff-dev/announce/": "${location.origin}/sdk/" } }</script>
<style>
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: light-dark(#f6f6f7, #111113);
    color: light-dark(#1c1c1f, #ededef); min-block-size: 100vh; }
  .page { padding: 16px 20px; color: light-dark(#71717a, #a1a1aa); }
  .bar { block-size: 10px; margin: 10px 0; border-radius: 4px; background: light-dark(#e4e4e7, #27272a); }
</style></head><body>
<oa-maintenance></oa-maintenance><oa-announcements></oa-announcements>
<div class="page">The host system<div class="bar" style="inline-size:60%"></div>
<div class="bar" style="inline-size:80%"></div><div class="bar" style="inline-size:40%"></div></div>
<oa-news style="--oa-sidebar-width: min(320px, 100vw)"></oa-news>
<script type="module">
  import '@openstuff-dev/announce/announcements/index.js';
  import '@openstuff-dev/announce/maintenance/index.js';
  import '@openstuff-dev/announce/news/index.js';
  window.parent.postMessage('openannounce:preview-ready', location.origin === 'null' ? '*' : location.origin);
</script></body></html>`);

  constructor() {
    effect(() => {
      const message = this.message();
      if (this.ready) this.show(message);
    });
    const onMessage = (event: MessageEvent) => {
      const fromFrame = event.source === this.frame().nativeElement.contentWindow;
      if (event.data === 'openannounce:preview-ready' && fromFrame) {
        this.ready = true;
        this.show(this.message());
      }
    };
    window.addEventListener('message', onMessage);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('message', onMessage);
    });
  }

  private show(message: FeedMessage): void {
    const doc = this.frame().nativeElement.contentDocument;
    if (!doc) return;
    for (const tag of ['oa-announcements', 'oa-maintenance', 'oa-news']) {
      const el = doc.querySelector<PreviewElement>(tag);
      if (el) el.messages = [message];
    }
    if (message.kind === 'news') doc.querySelector<PreviewElement>('oa-news')?.open?.();
  }
}
