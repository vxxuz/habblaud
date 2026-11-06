import type { AgentInfo, PendingArtifact } from '../../../shared/types';
import type { UiContext } from './context';
import { copyText, h, iconButton, setHidden, setText, setTitle } from './dom';
import { ICONS } from './icons';
import { tr } from '../../../shared/i18n';

export interface CeoDecisionPayload {
  agentId: string;
  artifactId: string;
  decision: 'approve' | 'reject';
  feedback?: string;
}

export function findPendingArtifactAgent(agents: readonly AgentInfo[]): AgentInfo | undefined {
  return agents.find((a) => !!a.pendingArtifact);
}

export function findPendingArtifactAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return agents.filter((a) => !!a.pendingArtifact);
}

export function formatArtifactTitle(artifactId: string): string {
  if (artifactId.endsWith('.md')) return artifactId;
  return `${artifactId}.md`;
}

export function formatArtifactSummary(summary: string): string {
  if (!summary || !summary.trim()) return tr('No summary provided.');
  return summary.trim();
}

export function ceoDecisionPayload(
  agentId: string,
  artifactId: string,
  decision: 'approve' | 'reject',
  feedback?: string,
): CeoDecisionPayload {
  const payload: CeoDecisionPayload = { agentId, artifactId, decision };
  if (decision === 'reject' && feedback) {
    payload.feedback = feedback;
  }
  return payload;
}

export class CeoApprovalCard {
  readonly el: HTMLElement;
  private itemsContainer: HTMLElement;
  private emptyNotice: HTMLElement;

  constructor(private ctx: UiContext) {
    const headIcon = h('span', { class: 'ui-ceo__icon', text: '👑' });
    const headTitle = h('span', { class: 'ui-ceo__title', text: tr('CEO Approval / Executive Review') });
    const head = h('div', { class: 'ui-ceo__head' }, headIcon, headTitle);

    this.itemsContainer = h('div', { class: 'ui-ceo__items' });
    this.emptyNotice = h('p', {
      class: 'ui-ceo__agent ui-muted',
      text: tr('No documents are awaiting CEO approval right now. All agents are working normally.'),
      hidden: true,
    });

    this.el = h('div', { class: 'ui-ceo', hidden: true }, head, this.emptyNotice, this.itemsContainer);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  render(agent: AgentInfo | undefined, allAgents?: readonly AgentInfo[]): void {
    if (!agent) {
      setHidden(this.el, true);
      return;
    }

    const isCeo = agent.id === 'ceo:inok';

    if (isCeo) {
      const candidates = findPendingArtifactAgents(allAgents ?? this.ctx.store.snapshot?.agents ?? []);
      if (candidates.length === 0) {
        setHidden(this.emptyNotice, false);
        this.itemsContainer.replaceChildren();
        setHidden(this.el, false);
        return;
      }

      setHidden(this.emptyNotice, true);
      this.itemsContainer.replaceChildren(
        ...candidates.map((a) => this.createItem(a, a.pendingArtifact!, true)),
      );
      setHidden(this.el, false);
      return;
    }

    if (!agent.pendingArtifact) {
      setHidden(this.el, true);
      return;
    }

    setHidden(this.emptyNotice, true);
    this.itemsContainer.replaceChildren(this.createItem(agent, agent.pendingArtifact, false));
    setHidden(this.el, false);
  }

  private createItem(agent: AgentInfo, artifact: PendingArtifact, isCeoView: boolean): HTMLElement {
    const itemEl = h('div', { class: 'ui-ceo__item' });

    const agentIntro = h('p', {
      class: 'ui-ceo__agent',
      text: isCeoView
        ? tr('Agent {0} is in your office presenting a document:', [agent.name])
        : tr('Agent is in the Executive Suite presenting a document to the CEO:'),
    });

    const docTitle = h('span', { class: 'ui-ceo__doc-name', text: formatArtifactTitle(artifact.id) });
    const copyBtn = iconButton(ICONS.copy, tr('Copy artifact path'), async () => {
      const ok = await copyText(artifact.path);
      copyBtn.innerHTML = ok ? ICONS.check : ICONS.copy;
      setTimeout(() => {
        copyBtn.innerHTML = ICONS.copy;
      }, 1400);
    }, 'ui-icon-btn--sm');

    const docHead = h('div', { class: 'ui-ceo__doc-title' }, docTitle, copyBtn);
    const docSummary = h('div', { class: 'ui-ceo__doc-summary', text: formatArtifactSummary(artifact.summary || '') });
    const docPath = h('div', { class: 'ui-muted ui-small ui-ceo__doc-path', text: artifact.path, title: artifact.path });
    const docBox = h('div', { class: 'ui-ceo__doc' }, docHead, docSummary, docPath);

    const statusText = h('p', { class: 'ui-ceo__status', hidden: true });

    const feedbackInput = h('textarea', {
      class: 'ui-ceo__feedback',
      attrs: { rows: 3, placeholder: tr('Revision notes for the agent…') },
    });

    let denyForm: HTMLElement;

    const approveBtn = h('button', {
      class: 'ui-btn ui-ceo__btn--approve',
      type: 'button',
      text: tr('✓ Approve'),
      on: {
        click: async () => {
          approveBtn.disabled = true;
          rejectToggleBtn.disabled = true;
          setHidden(statusText, false);
          setText(statusText, tr('Approving document…'));

          const ok = await this.sendDecision(agent.id, artifact.id, 'approve');
          if (ok) {
            setText(statusText, tr('✓ Document approved! Agent is resuming work.'));
            setTimeout(() => {
              itemEl.remove();
              this.ctx.invalidate();
            }, 600);
          } else {
            approveBtn.disabled = false;
            rejectToggleBtn.disabled = false;
          }
        },
      },
    });

    const rejectToggleBtn = h('button', {
      class: 'ui-btn ui-ceo__btn--reject',
      type: 'button',
      text: tr('✕ Reject / Feedback…'),
      on: {
        click: () => {
          const isHidden = denyForm.hidden;
          setHidden(denyForm, !isHidden);
          if (isHidden) {
            feedbackInput.value = '';
            feedbackInput.focus();
          }
        },
      },
    });

    const submitRejectBtn = h('button', {
      class: 'ui-btn ui-ceo__btn--reject',
      type: 'button',
      text: tr('Send Rejection'),
      on: {
        click: async () => {
          const feedback = feedbackInput.value.trim();
          approveBtn.disabled = true;
          rejectToggleBtn.disabled = true;
          submitRejectBtn.disabled = true;
          setHidden(statusText, false);
          setText(statusText, tr('Sending revision notes…'));

          const ok = await this.sendDecision(agent.id, artifact.id, 'reject', feedback);
          if (ok) {
            setText(statusText, tr('Revision notes sent to agent.'));
            setTimeout(() => {
              itemEl.remove();
              this.ctx.invalidate();
            }, 600);
          } else {
            approveBtn.disabled = false;
            rejectToggleBtn.disabled = false;
            submitRejectBtn.disabled = false;
          }
        },
      },
    });

    const cancelRejectBtn = h('button', {
      class: 'ui-btn',
      type: 'button',
      text: tr('Cancel'),
      on: {
        click: () => {
          setHidden(denyForm, true);
        },
      },
    });

    const denyActions = h('div', { class: 'ui-ceo__actions' }, submitRejectBtn, cancelRejectBtn);
    denyForm = h('div', { class: 'ui-ceo__deny', hidden: true }, feedbackInput, denyActions);

    const actionsRow = h('div', { class: 'ui-ceo__actions' }, approveBtn, rejectToggleBtn);

    itemEl.append(agentIntro, docBox, actionsRow, denyForm, statusText);
    return itemEl;
  }

  private async sendDecision(agentId: string, artifactId: string, decision: 'approve' | 'reject', feedback?: string): Promise<boolean> {
    const payload = ceoDecisionPayload(agentId, artifactId, decision, feedback);

    try {
      const res = await fetch('/api/ceo/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Optimistically clear pending artifact on agent in store and context
      const live = this.ctx.agent(agentId);
      if (live) {
        live.pendingArtifact = undefined;
        if (live.status === 'waiting') {
          live.status = 'working';
        }
      }
      const snapAgent = this.ctx.store.snapshot?.agents.find((a) => a.id === agentId);
      if (snapAgent) {
        snapAgent.pendingArtifact = undefined;
        if (snapAgent.status === 'waiting') {
          snapAgent.status = 'working';
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}
