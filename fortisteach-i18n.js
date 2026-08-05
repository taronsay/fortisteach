(function () {
  'use strict';

  const STORAGE_KEY = 'fortisteachLanguage';
  const DEFAULT_LANGUAGE = 'en';
  const SUPPORTED = ['en', 'hy', 'ru'];
  const LABELS = { en: 'En', hy: 'Hy', ru: 'Ru' };
  const translations = window.FortisTeachTranslations || { en: {}, hy: {}, ru: {} };
  const textRecords = new Map();
  const attrRecords = [];
  const metaRecords = [];
  let currentLanguage = DEFAULT_LANGUAGE;
  let applying = false;
  let refreshTimer = null;

  const normalize = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\n ]+/g, ' ')
    .trim();

  function isExcluded(element) {
    if (!element || element.nodeType !== 1) return true;
    return Boolean(element.closest(
      'script,style,noscript,svg,canvas,iframe,template,[data-no-i18n],[data-lang],[data-current-lang]'
    ));
  }

  function buildReverseIndex() {
    const index = Object.create(null);
    for (const lang of SUPPORTED) {
      const dictionary = translations[lang] || {};
      for (const [english, value] of Object.entries(dictionary)) {
        const normalizedEnglish = normalize(english);
        const normalizedValue = normalize(value);
        if (normalizedEnglish) index[normalizedEnglish] = english;
        if (normalizedValue) index[normalizedValue] = english;
      }
    }
    return index;
  }

  const reverseIndex = buildReverseIndex();

  function sourceFor(value) {
    return reverseIndex[normalize(value)] || null;
  }

  function cacheTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || textRecords.has(node)) return;
    const parent = node.parentElement;
    if (!parent || isExcluded(parent)) return;
    const source = sourceFor(node.nodeValue);
    if (!source) return;
    const raw = node.nodeValue || '';
    textRecords.set(node, {
      source,
      leading: (raw.match(/^\s*/) || [''])[0],
      trailing: (raw.match(/\s*$/) || [''])[0]
    });
  }

  function cacheElementAttributes(element) {
    if (!element || element.nodeType !== 1 || isExcluded(element)) return;
    const attrs = ['placeholder', 'title', 'alt', 'aria-label', 'value'];
    for (const attr of attrs) {
      if (!element.hasAttribute(attr)) continue;
      const source = sourceFor(element.getAttribute(attr));
      if (!source) continue;
      if (!attrRecords.some((record) => record.element === element && record.attr === attr)) {
        attrRecords.push({ element, attr, source });
      }
    }
  }

  function cacheSubtree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      cacheTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root !== document.body) return;
    if (root.nodeType === Node.ELEMENT_NODE) cacheElementAttributes(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || isExcluded(parent)) return NodeFilter.FILTER_REJECT;
        return sourceFor(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) cacheTextNode(walker.currentNode);

    if (root.querySelectorAll) {
      root.querySelectorAll('*').forEach(cacheElementAttributes);
    }
  }

  function cacheMeta() {
    metaRecords.length = 0;
    const titleSource = sourceFor(document.title);
    if (titleSource) metaRecords.push({ type: 'title', source: titleSource });
    document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"],meta[name="twitter:title"],meta[name="twitter:description"]').forEach((element) => {
      const source = sourceFor(element.getAttribute('content'));
      if (source) metaRecords.push({ type: 'meta', element, source });
    });
  }

  function getTranslation(source, lang) {
    if (lang === 'en') return source;
    return translations[lang]?.[source] || source;
  }

  function updateLanguageControls(lang) {
    document.querySelectorAll('[data-current-lang]').forEach((element) => {
      element.textContent = LABELS[lang] || lang.toUpperCase();
    });
    document.querySelectorAll('[data-lang]').forEach((element) => {
      const active = element.getAttribute('data-lang') === lang;
      element.classList.toggle('is-active-language', active);
      if (active) element.setAttribute('aria-current', 'true');
      else element.removeAttribute('aria-current');
    });
  }

  function applyLanguage(lang) {
    if (!SUPPORTED.includes(lang)) lang = DEFAULT_LANGUAGE;
    currentLanguage = lang;
    applying = true;

    textRecords.forEach((record, node) => {
      if (!node.isConnected) {
        textRecords.delete(node);
        return;
      }
      node.nodeValue = record.leading + getTranslation(record.source, lang) + record.trailing;
    });

    for (let i = attrRecords.length - 1; i >= 0; i--) {
      const record = attrRecords[i];
      if (!record.element.isConnected) {
        attrRecords.splice(i, 1);
        continue;
      }
      record.element.setAttribute(record.attr, getTranslation(record.source, lang));
    }

    metaRecords.forEach((record) => {
      const value = getTranslation(record.source, lang);
      if (record.type === 'title') document.title = value;
      else if (record.element?.isConnected) record.element.setAttribute('content', value);
    });

    document.documentElement.lang = lang;
    document.documentElement.classList.toggle('lang-hy', lang === 'hy');
    localStorage.setItem(STORAGE_KEY, lang);
    updateLanguageControls(lang);
    applying = false;
    window.dispatchEvent(new CustomEvent('fortisteach:languagechange', { detail: { language: lang } }));
  }

  function bindLanguageButtons() {
    document.querySelectorAll('[data-lang]').forEach((button) => {
      // The main dropdown trigger opens the menu; it must never switch language.
      if (
        button.matches(
          '.fortis-language-trigger, [data-language-trigger], [data-desktop-language-trigger] .fortis-language-trigger'
        )
      ) {
        button.removeAttribute('data-lang');
        return;
      }

      if (button.dataset.ftI18nBound === 'true') return;

      const lang = button.getAttribute('data-lang');
      if (!SUPPORTED.includes(lang)) return;

      button.dataset.ftI18nBound = 'true';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        applyLanguage(lang);
      });
    });
  }

  function refresh() {
    bindLanguageButtons();
    cacheSubtree(document.body);
    cacheMeta();
    applyLanguage(currentLanguage);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 80);
  }

  function initialLanguage() {
    const query = new URLSearchParams(location.search).get('lang');
    if (SUPPORTED.includes(query)) return query;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.includes(saved)) return saved;
    const browser = (navigator.language || '').toLowerCase();
    if (browser.startsWith('hy')) return 'hy';
    if (browser.startsWith('ru')) return 'ru';
    return DEFAULT_LANGUAGE;
  }

  function debugMissing() {
    const missing = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || isExcluded(parent)) return NodeFilter.FILTER_REJECT;
        const text = normalize(node.nodeValue);
        if (!text || !/[A-Za-z]/.test(text) || sourceFor(text)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) missing.add(normalize(walker.currentNode.nodeValue));
    const result = [...missing].sort();
    console.table(result);
    return result;
  }

  async function copyMissing() {
    const result = debugMissing();
    const output = JSON.stringify(result, null, 2);

    try {
      await navigator.clipboard.writeText(output);
      console.info('FortisTeach i18n: missing strings copied to clipboard.');
    } catch (error) {
      console.info('FortisTeach i18n: copy the array below manually.');
      console.log(output);
    }

    return result;
  }

  function init() {
    currentLanguage = initialLanguage();

    // Clean up data-lang accidentally added by older versions of this script.
    document.querySelectorAll('.fortis-language-trigger[data-lang]').forEach((trigger) => {
      trigger.removeAttribute('data-lang');
      delete trigger.dataset.ftI18nBound;
    });

    bindLanguageButtons();
    cacheSubtree(document.body);
    cacheMeta();
    applyLanguage(currentLanguage);

    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      let changed = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => cacheSubtree(node));
          changed = changed || mutation.addedNodes.length > 0;
        } else if (mutation.type === 'attributes') {
          cacheElementAttributes(mutation.target);
          changed = true;
        }
      }
      if (changed) scheduleRefresh();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'alt', 'aria-label', 'value']
    });

    window.setFortisTeachLanguage = applyLanguage;
    window.fortisTeachRefreshI18n = refresh;
    window.fortisTeachI18nDebug = debugMissing;
    window.fortisTeachCopyMissingI18n = copyMissing;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
