import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Camera } from './camera';
import { attachInput, type InputHandlers } from './input';

/** `window` mínimo: o listener de teclado da câmera registra em `keydown`. */
function installWindow(): { dispatch(ev: { key: string; target: unknown }): void; restore(): void } {
  const prev = globalThis.window;
  const listeners = new Set<(ev: KeyboardEvent) => void>();
  globalThis.window = {
    addEventListener(_type: string, fn: (ev: KeyboardEvent) => void) {
      listeners.add(fn);
    },
    removeEventListener(_type: string, fn: (ev: KeyboardEvent) => void) {
      listeners.delete(fn);
    },
  } as unknown as Window & typeof globalThis;
  return {
    dispatch(partial) {
      const ev = {
        defaultPrevented: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...partial,
      };
      for (const fn of listeners) fn(ev as unknown as KeyboardEvent);
    },
    restore() {
      globalThis.window = prev;
    },
  };
}

function canvas(): HTMLCanvasElement {
  return {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    setPointerCapture() {},
  } as unknown as HTMLCanvasElement;
}

function handlers(): InputHandlers {
  return { pick: () => null, click() {}, doubleClick() {}, hover() {}, interact() {}, overview() {}, zoomStep() {} };
}

describe('teclado da câmera', () => {
  let win: ReturnType<typeof installWindow>;
  let off: (() => void) | null = null;

  afterEach(() => {
    off?.();
    off = null;
    win?.restore();
  });

  it('ArrowRight com foco num rádio não move a câmera', () => {
    win = installWindow();
    const pans: [number, number][] = [];
    const camera = { zoom: 1, panBy: (dx: number, dy: number) => pans.push([dx, dy]), zoomAt() {}, settle() {} } as unknown as Camera;
    off = attachInput(canvas(), camera, handlers());
    win.dispatch({
      key: 'ArrowRight',
      target: {
        tagName: 'BUTTON',
        isContentEditable: false,
        getAttribute: (name: string) => (name === 'role' ? 'radio' : null),
      },
    });
    // O bug: a seta do grupo de velocidade chegava aqui como panBy(-90, 0).
    expect(pans).toEqual([]);
  });

  it('ArrowRight com foco num botão comum continua movendo a câmera', () => {
    win = installWindow();
    const pans: [number, number][] = [];
    const camera = { zoom: 1, panBy: (dx: number, dy: number) => pans.push([dx, dy]), zoomAt() {}, settle() {} } as unknown as Camera;
    off = attachInput(canvas(), camera, handlers());
    // Depois de clicar num botão da barra, o foco fica nele: as setas ainda são da câmera.
    win.dispatch({ key: 'ArrowRight', target: { tagName: 'BUTTON', isContentEditable: false, getAttribute: () => null } });
    expect(pans).toEqual([[-90, 0]]);
  });

  it('ArrowRight com foco no mundo continua movendo a câmera', () => {
    win = installWindow();
    const pans: [number, number][] = [];
    const camera = { zoom: 1, panBy: (dx: number, dy: number) => pans.push([dx, dy]), zoomAt() {}, settle() {} } as unknown as Camera;
    off = attachInput(canvas(), camera, handlers());
    win.dispatch({
      key: 'ArrowRight',
      target: { tagName: 'BODY', isContentEditable: false },
    });
    expect(pans).toEqual([[-90, 0]]);
  });
});

describe('arrastar com mouse (pan / grab da câmera)', () => {
  let win: ReturnType<typeof installWindow>;

  beforeEach(() => {
    win = installWindow();
  });

  afterEach(() => {
    win?.restore();
  });
  function createEventCanvas() {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const captureListeners: Record<string, ((e: unknown) => void)[]> = {};
    return {
      style: {} as Record<string, string>,
      addEventListener(type: string, fn: (e: unknown) => void, opts?: boolean | AddEventListenerOptions) {
        const useCapture = typeof opts === 'boolean' ? opts : opts?.capture;
        const target = useCapture ? captureListeners : listeners;
        (target[type] ??= []).push(fn);
      },
      removeEventListener(type: string, fn: (e: unknown) => void, opts?: boolean | AddEventListenerOptions) {
        const useCapture = typeof opts === 'boolean' ? opts : opts?.capture;
        const target = useCapture ? captureListeners : listeners;
        target[type] = (target[type] ?? []).filter((l) => l !== fn);
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      setPointerCapture() {},
      dispatch(type: string, ev: Record<string, unknown>) {
        const e = {
          defaultPrevented: false,
          immediateStopped: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
          stopImmediatePropagation() {
            this.immediateStopped = true;
          },
          stopPropagation() {},
          ...ev,
        };
        for (const fn of captureListeners[type] ?? []) {
          if (e.immediateStopped) break;
          fn(e);
        }
        for (const fn of listeners[type] ?? []) {
          if (e.immediateStopped) break;
          fn(e);
        }
        return e;
      },
    };
  }

  it('tahan klik kiri (button: 0) e arrastar move a câmera e não dispara clique', () => {
    const cv = createEventCanvas();
    const pans: [number, number][] = [];
    let clicked = false;
    const camera = { zoom: 1, panBy: (dx: number, dy: number) => pans.push([dx, dy]), zoomAt() {}, settle() {} } as unknown as Camera;
    const off = attachInput(cv as unknown as HTMLCanvasElement, camera, {
      ...handlers(),
      click: () => {
        clicked = true;
      },
    });

    cv.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    cv.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 120, clientY: 110 });
    expect(pans).toEqual([[20, 10]]);
    expect(cv.style.cursor).toBe('grabbing');

    cv.dispatch('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 120, clientY: 110 });
    expect(clicked).toBe(false);
    expect(cv.style.cursor).toBe('grab');
    off();
  });

  it('tahan klik kanan (button: 2) e arrastar move a câmera e cancela menu de contexto', () => {
    const cv = createEventCanvas();
    const pans: [number, number][] = [];
    let clicked = false;
    const camera = { zoom: 1, panBy: (dx: number, dy: number) => pans.push([dx, dy]), zoomAt() {}, settle() {} } as unknown as Camera;
    const off = attachInput(cv as unknown as HTMLCanvasElement, camera, {
      ...handlers(),
      click: () => {
        clicked = true;
      },
    });

    cv.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 50, clientY: 50 });
    cv.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 80, clientY: 90 });
    expect(pans).toEqual([[30, 40]]);
    expect(cv.style.cursor).toBe('grabbing');

    cv.dispatch('pointerup', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 80, clientY: 90 });
    expect(clicked).toBe(false);

    // O contextmenu depois do drag com botão direito deve ser suprimido
    const ctxEvent = cv.dispatch('contextmenu', { clientX: 80, clientY: 90 });
    expect(ctxEvent.defaultPrevented).toBe(true);
    expect(ctxEvent.immediateStopped).toBe(true);
    off();
  });

  it('clique simples com botão esquerdo (sem arrastar) chama o handler de click', () => {
    const cv = createEventCanvas();
    let clicked = false;
    const camera = { zoom: 1, panBy() {}, zoomAt() {}, settle() {} } as unknown as Camera;
    const off = attachInput(cv as unknown as HTMLCanvasElement, camera, {
      ...handlers(),
      click: () => {
        clicked = true;
      },
    });

    cv.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    cv.dispatch('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 101, clientY: 101 });
    expect(clicked).toBe(true);
    off();
  });

  it('clique simples com botão direito (sem arrastar) não chama click e deixa o contextmenu passar', () => {
    const cv = createEventCanvas();
    let clicked = false;
    const camera = { zoom: 1, panBy() {}, zoomAt() {}, settle() {} } as unknown as Camera;
    const off = attachInput(cv as unknown as HTMLCanvasElement, camera, {
      ...handlers(),
      click: () => {
        clicked = true;
      },
    });

    cv.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 100, clientY: 100 });
    cv.dispatch('pointerup', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 101, clientY: 101 });
    expect(clicked).toBe(false);

    // Contextmenu não deve ser prevenido
    const ctxEvent = cv.dispatch('contextmenu', { clientX: 101, clientY: 101 });
    expect(ctxEvent.defaultPrevented).toBe(false);
    expect(ctxEvent.immediateStopped).toBe(false);
    off();
  });
});

describe('modalOpen', () => {
  /** `document` mínimo: alguns elementos e o `querySelector` dos dois seletores que a função usa. */
  function installDocument(els: { tag: string; open?: boolean; ariaModal?: boolean }[]): () => void {
    const prev = globalThis.document;
    const matches = (sel: string, e: (typeof els)[number]): boolean => {
      if (sel === 'dialog[open]') return e.tag === 'dialog' && !!e.open;
      if (sel === ':not(dialog)[aria-modal="true"]') return e.tag !== 'dialog' && !!e.ariaModal;
      if (sel === '[aria-modal="true"]') return !!e.ariaModal;
      if (sel === ':popover-open') return false;
      throw new Error(`seletor inesperado no teste: ${sel}`);
    };
    globalThis.document = {
      querySelector: (sel: string) => els.find((e) => sel.split(', ').some((s) => matches(s, e))) ?? null,
    } as unknown as Document;
    return () => {
      globalThis.document = prev;
    };
  }

  it('um <dialog> fechado (mesmo com aria-modal) não bloqueia o teclado da cidade', async () => {
    const { modalOpen } = await import('./input');
    const restore = installDocument([{ tag: 'dialog', open: false, ariaModal: true }]);
    try {
      expect(modalOpen(null)).toBe(false);
    } finally {
      restore();
    }
  });

  it('um <dialog> aberto, ou outro elemento com aria-modal, bloqueia', async () => {
    const { modalOpen } = await import('./input');
    for (const els of [[{ tag: 'dialog', open: true }], [{ tag: 'div', ariaModal: true }]]) {
      const restore = installDocument(els);
      try {
        expect(modalOpen(null)).toBe(true);
      } finally {
        restore();
      }
    }
  });
});
