export function syncMobileNav(activeTab) {
  const desktopList = document.getElementById('nav-list');
  const mobileList = document.getElementById('mobile-nav-list');
  if (desktopList && mobileList) {
    mobileList.innerHTML = desktopList.innerHTML;
  }

  const dashDesktop = desktopList?.querySelector('[data-tab="dashboard"]');
  const dashHidden = Boolean(dashDesktop?.hidden);

  document.querySelectorAll('#mobile-bottom-nav .bottom-nav-btn[data-tab]').forEach(btn => {
    if (btn.dataset.tab === 'dashboard') {
      btn.hidden = dashHidden;
    }
    if (btn.dataset.tab === activeTab) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });
}

export function initMobileDrawer(ctx) {
  const drawer = document.getElementById('mobile-nav-drawer');
  const openBtn = document.getElementById('btn-mobile-menu');
  const bottomOpenBtn = document.getElementById('btn-bottom-menu');
  const closeBtn = document.getElementById('mobile-drawer-close');
  if (!drawer) return;

  const scroller = drawer.querySelector('.Drawer-scroller');
  const sheet = drawer.querySelector('.Drawer-sheet');
  if (!scroller || !sheet) return;

  async function openDrawer() {
    syncMobileNav(ctx.state?.activeTab);
    if (!drawer.open) drawer.showModal();

    if (!CSS.supports('scroll-initial-target', 'nearest')) {
      scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'instant' });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    scroller.scrollTo({ left: 0, behavior: 'auto' });
  }

  function closeDrawer() {
    if (!drawer.open) return;
    scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'auto' });
  }

  if (!CSS.supports('animation-timeline: scroll()')) {
    scroller.addEventListener('scroll', () => {
      const width = sheet.offsetWidth || 1;
      const ratio = Math.max(0, Math.min(1, 1 - scroller.scrollLeft / width));
      drawer.style.setProperty('--drawer-backdrop', String(ratio));
    });
  }

  const visibleThreshold = Math.min(0.05, 1 / Math.max(window.innerWidth, 320));
  const observer = new IntersectionObserver(
    entries => {
      const entry = entries.at(-1);
      if (!entry) return;
      if (entry.intersectionRatio < visibleThreshold && drawer.open) {
        drawer.close();
        openBtn?.setAttribute('aria-expanded', 'false');
      } else if (entry.intersectionRatio >= 0.99) {
        openBtn?.setAttribute('aria-expanded', 'true');
      }
    },
    { root: drawer, threshold: [visibleThreshold, 1] }
  );
  observer.observe(sheet);

  openBtn?.addEventListener('click', openDrawer);
  bottomOpenBtn?.addEventListener('click', openDrawer);
  closeBtn?.addEventListener('click', closeDrawer);

  drawer.addEventListener('click', e => {
    if (!sheet.contains(e.target)) closeDrawer();
  });

  drawer.addEventListener('cancel', e => {
    if (e.cancelable) {
      e.preventDefault();
      closeDrawer();
    }
  });

  document.getElementById('mobile-nav-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.nav-btn');
    if (!btn || !btn.dataset.tab) return;
    drawer.close();
    openBtn?.setAttribute('aria-expanded', 'false');
    ctx.goto(btn.dataset.tab);
  });

  document.getElementById('mobile-bottom-nav')?.addEventListener('click', e => {
    const btn = e.target.closest('.bottom-nav-btn[data-tab]');
    if (!btn) return;
    ctx.goto(btn.dataset.tab);
  });
}

