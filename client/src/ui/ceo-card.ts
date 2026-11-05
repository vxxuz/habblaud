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

export function formatArtifactTitle(artifactId: string): string {
  if (artifactId.endsWith('.md')) return artifactId;
  return `${artifactId}.md`;
}

export function formatArtifactSummary(summary: string): string {
  if (!summary || !summary.trim()) return tr('Sem resumo fornecido.');
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
  private currentAgentId: string | null = null;
  private currentArtifact: PendingArtifact | null = null;
  private busy = false;

  private headIcon: HTMLElement;
  private headTitle: HTMLElement;
  private agentText: HTMLElement;
  private docTitle: HTMLElement;
  private docPath: HTMLElement;
  private docSummary: HTMLElement;
  private copyBtn: HTMLButtonElement;
  private actionsRow: HTMLElement;
  private approveBtn: HTMLButtonElement;
  private rejectToggleBtn: HTMLButtonElement;
  private denyForm: HTMLFormElement;
  private feedbackInput: HTMLTextAreaElement;
  private submitRejectBtn: HTMLButtonElement;
  private cancelRejectBtn: HTMLButtonElement;
  private statusText: HTMLElement;

  constructor(private ctx: UiContext) {
    this.headIcon = h('span', { class: 'ui-ceo__icon', text: '👑' });
    this.headTitle = h('span', { class: 'ui-ceo__title', text: tr('Persetujuan CEO / Executive Review') });

    const head = h('div', { class: 'ui-ceo__head' }, this.headIcon, this.headTitle);

    this.agentText = h('p', { class: 'ui-ceo__agent' });

    this.docTitle = h('span', { class: 'ui-ceo__doc-name' });
    this.copyBtn = iconButton(ICONS.copy, tr('Salin path artifact'), async () => {
      if (!this.currentArtifact) return;
      const ok = await copyText(this.currentArtifact.path);
      this.copyBtn.innerHTML = ok ? ICONS.check : ICONS.copy;
      setTimeout(() => {
        this.copyBtn.innerHTML = ICONS.copy;
      }, 1400);
    }, 'ui-icon-btn--sm');

    const docHead = h('div', { class: 'ui-ceo__doc-title' }, this.docTitle, this.copyBtn);
    this.docSummary = h('div', { class: 'ui-ceo__doc-summary' });
    this.docPath = h('div', { class: 'ui-muted ui-small ui-ceo__doc-path' });

    const docBox = h('div', { class: 'ui-ceo__doc' }, docHead, this.docSummary, this.docPath);

    this.approveBtn = h(
      'button',
      {
        class: 'ui-btn ui-ceo__btn--approve',
        type: 'button',
        text: tr('✓ Setujui (Approve)'),
        on: { click: () => this.handleApprove() },
      },
    );

    this.rejectToggleBtn = h(
      'button',
      {
        class: 'ui-btn ui-ceo__btn--reject',
        type: 'button',
        text: tr('✕ Tolak / Feedback…'),
        on: { click: () => this.toggleDeny() },
      },
    );

    this.actionsRow = h('div', { class: 'ui-ceo__actions' }, this.approveBtn, this.rejectToggleBtn);

    this.feedbackInput = h('textarea', {
      class: 'ui-ceo__feedback',
      attrs: { rows: 3, placeholder: tr('Catatan revisi untuk agen…') },
    });

    this.submitRejectBtn = h(
      'button',
      {
        class: 'ui-btn ui-ceo__btn--reject',
        type: 'button',
        text: tr('Kirim Penolakan'),
        on: { click: () => this.handleReject() },
      },
    );

    this.cancelRejectBtn = h(
      'button',
      {
        class: 'ui-btn',
        type: 'button',
        text: tr('Batal'),
        on: { click: () => this.toggleDeny(false) },
      },
    );

    const denyActions = h('div', { class: 'ui-ceo__actions' }, this.submitRejectBtn, this.cancelRejectBtn);
    this.denyForm = h('div', { class: 'ui-ceo__deny', hidden: true }, this.feedbackInput, denyActions);

    this.statusText = h('p', { class: 'ui-ceo__status', hidden: true });

    this.el = h(
      'div',
      { class: 'ui-ceo', hidden: true },
      head,
      this.agentText,
      docBox,
      this.actionsRow,
      this.denyForm,
      this.statusText,
    );
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
    let targetAgent: AgentInfo | undefined = agent;
    let artifact = agent.pendingArtifact;

    if (isCeo) {
      // If CEO is selected, check if there is an agent presenting an artifact
      const candidate = findPendingArtifactAgent(allAgents ?? this.ctx.store.snapshot?.agents ?? []);
      if (candidate?.pendingArtifact) {
        targetAgent = candidate;
        artifact = candidate.pendingArtifact;
      } else {
        // CEO with no pending artifacts
        this.currentAgentId = null;
        this.currentArtifact = null;
        setText(this.agentText, tr('Tidak ada dokumen yang menunggu persetujuan CEO saat ini. Semua agen bekerja normal.'));
        setHidden(this.docSummary.parentElement!, true);
        setHidden(this.actionsRow, true);
        setHidden(this.denyForm, true);
        setHidden(this.statusText, true);
        setHidden(this.el, false);
        return;
      }
    }

    if (!artifact) {
      this.currentAgentId = null;
      this.currentArtifact = null;
      setHidden(this.el, true);
      return;
    }

    this.currentAgentId = targetAgent.id;
    this.currentArtifact = artifact;

    setHidden(this.docSummary.parentElement!, false);
    setHidden(this.actionsRow, false);
    setHidden(this.el, false);

    const agentName = targetAgent.name;
    setText(
      this.agentText,
      isCeo
        ? tr('Agen {0} sedang menghadap Anda membawa dokumen:', [agentName])
        : tr('Agen sedang menghadap CEO di Executive Suite membawa dokumen:'),
    );

    setText(this.docTitle, formatArtifactTitle(artifact.id));
    setText(this.docSummary, formatArtifactSummary(artifact.summary));
    setText(this.docPath, artifact.path);
    setTitle(this.docPath, artifact.path);
  }

  private toggleDeny(open?: boolean): void {
    const shouldOpen = open !== undefined ? open : this.denyForm.hidden;
    setHidden(this.denyForm, !shouldOpen);
    if (shouldOpen) {
      this.feedbackInput.value = '';
      this.feedbackInput.focus();
    }
  }

  private async handleApprove(): Promise<void> {
    if (this.busy || !this.currentAgentId || !this.currentArtifact) return;
    await this.sendDecision('approve');
  }

  private async handleReject(): Promise<void> {
    if (this.busy || !this.currentAgentId || !this.currentArtifact) return;
    const feedback = this.feedbackInput.value.trim();
    await this.sendDecision('reject', feedback);
  }

  private async sendDecision(decision: 'approve' | 'reject', feedback?: string): Promise<void> {
    if (!this.currentAgentId || !this.currentArtifact) return;
    this.busy = true;
    this.approveBtn.disabled = true;
    this.rejectToggleBtn.disabled = true;
    this.submitRejectBtn.disabled = true;

    setHidden(this.statusText, false);
    setText(this.statusText, decision === 'approve' ? tr('Menyetujui dokumen…') : tr('Mengirim revisi…'));

    const payload = ceoDecisionPayload(this.currentAgentId, this.currentArtifact.id, decision, feedback);

    try {
      const res = await fetch('/api/ceo/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      setText(
        this.statusText,
        decision === 'approve' ? tr('✓ Dokumen disetujui! Agen melanjutkan tugas.') : tr('Revisi dikirim ke agen.'),
      );

      // Optimistically clear pending artifact on agent
      const agent = this.ctx.agent(this.currentAgentId);
      if (agent) {
        agent.pendingArtifact = undefined;
      }

      setTimeout(() => {
        setHidden(this.statusText, true);
        this.toggleDeny(false);
        this.busy = false;
        this.approveBtn.disabled = false;
        this.rejectToggleBtn.disabled = false;
        this.submitRejectBtn.disabled = false;
        this.ctx.invalidate();
      }, 1000);
    } catch (err: any) {
      setText(this.statusText, tr('Gagal mengirim keputusan: {0}', [err?.message ?? 'error']));
      this.busy = false;
      this.approveBtn.disabled = false;
      this.rejectToggleBtn.disabled = false;
      this.submitRejectBtn.disabled = false;
    }
  }
}
