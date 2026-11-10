export interface View {
  readonly el: HTMLElement;
  /** Stop animation, sound hooks and listeners. The element is removed by the app. */
  destroy(): void;
}

export const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';

export function wordmark(tag: 'a' | 'div' = 'div') {
  const attrs = tag === 'a' ? ' href="#/" aria-label="mong 홈으로"' : '';
  return `<${tag} class="wordmark"${attrs}><span class="orb" aria-hidden="true"></span>mong</${tag}>`;
}
