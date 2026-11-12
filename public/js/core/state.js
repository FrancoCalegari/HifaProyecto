// Estado único de la app. Se muta, nunca se reasigna.
export const state = {
  token: (typeof localStorage !== 'undefined' && localStorage.getItem('hifa_token')) || '',
  user: null,
  partner: null,
  couple: null,
  notifications: [],
  config: {},
  activeTab: 'couple',
  booted: false,
  selectedWalletId: null,
  activeNotebookId: null,
  activePageId: null,
  countdownTimer: null
};

export function profilesReady() {
  return Boolean(state.user?.profile_completed && state.partner?.profile_completed && state.couple?.relationship_start);
}
