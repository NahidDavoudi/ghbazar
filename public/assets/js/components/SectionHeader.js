const SectionHeader = {
  render({ title, icon, href, label, titleClass = '', linkClass = '', iconClass = '' } = {}) {
    const iconHtml = icon
      ? `<i data-lucide="${icon}" class="${iconClass || 'w-6 h-6 text-accent'}"></i>`
      : '';
    const linkHtml = href && label
      ? `<a href="${href}" data-link class="${linkClass || 'text-muted text-xs md:text-sm hover:text-body transition-colors flex flex-row-reverse items-center gap-1 shrink-0'}">
           <i data-lucide="chevron-left" class="w-3.5 h-3.5"></i><span>${label}</span>
         </a>`
      : '';

    return `
      <div class="flex flex-row-reverse items-center justify-between mb-4 md:mb-6 px-4 md:px-6" dir="rtl">
        <h2 class="${titleClass || 'text-2xl md:text-4xl font-bold text-body text-right'}">${iconHtml}<span>${title}</span></h2>
        ${linkHtml}
      </div>`;
  },

  bind() { /* router handles links */ },
};

export default SectionHeader;
