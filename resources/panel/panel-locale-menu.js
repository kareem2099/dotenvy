/**
 * Locale dropdown for the environment dashboard.
 * Reads vscode and the active locale from window.dotenvyPanelShared.
 */
function shared() {
    return window.dotenvyPanelShared;
}

function renderLocaleMenu() {
    const menu = document.getElementById('locale-dropdown-menu');
    if (!menu) {
        return;
    }

    menu.innerHTML = '';
    for (const entry of shared().availableLocales) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'locale-dropdown-option';
        option.setAttribute('role', 'option');
        option.dataset.locale = entry.code;
        const labelKey = `panel.language.${entry.code}`;
        option.setAttribute('data-i18n', labelKey);
        const translated = tr(labelKey);
        option.textContent = translated !== labelKey ? translated : entry.label;
        menu.appendChild(option);
    }
}

function syncLocaleDropdown() {
    const menu = document.getElementById('locale-dropdown-menu');
    const valueEl = document.getElementById('locale-dropdown-value');
    if (!menu || !valueEl || !shared().currentLocale) {
        return;
    }

    if (menu.childElementCount === 0) {
        renderLocaleMenu();
    }

    menu.querySelectorAll('.locale-dropdown-option').forEach((opt) => {
        const isSelected = opt.dataset.locale === shared().currentLocale;
        opt.classList.toggle('is-selected', isSelected);
        opt.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });

    const selectedOpt = menu.querySelector(`[data-locale="${shared().currentLocale}"]`);
    if (selectedOpt) {
        const key = selectedOpt.getAttribute('data-i18n');
        valueEl.textContent = key ? tr(key) : selectedOpt.textContent;
    }
}

let localeDropdownScrollHandler = null;

function positionLocaleDropdownMenu() {
    const trigger = document.getElementById('locale-dropdown-trigger');
    const menu = document.getElementById('locale-dropdown-menu');
    if (!trigger || !menu) {
        return;
    }
    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    menu.style.width = `${rect.width}px`;
}

function closeLocaleDropdown() {
    const dropdown = document.getElementById('locale-dropdown');
    const trigger = document.getElementById('locale-dropdown-trigger');
    const menu = document.getElementById('locale-dropdown-menu');
    if (!dropdown || !trigger || !menu) {
        return;
    }
    dropdown.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
    if (localeDropdownScrollHandler) {
        window.removeEventListener('scroll', localeDropdownScrollHandler, true);
        window.removeEventListener('resize', localeDropdownScrollHandler);
        localeDropdownScrollHandler = null;
    }
}

function openLocaleDropdown() {
    const dropdown = document.getElementById('locale-dropdown');
    const trigger = document.getElementById('locale-dropdown-trigger');
    const menu = document.getElementById('locale-dropdown-menu');
    if (!dropdown || !trigger || !menu) {
        return;
    }
    dropdown.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    positionLocaleDropdownMenu();
    localeDropdownScrollHandler = () => closeLocaleDropdown();
    window.addEventListener('scroll', localeDropdownScrollHandler, true);
    window.addEventListener('resize', localeDropdownScrollHandler);
}

function toggleLocaleDropdown() {
    const dropdown = document.getElementById('locale-dropdown');
    if (!dropdown) {
        return;
    }
    if (dropdown.classList.contains('is-open')) {
        closeLocaleDropdown();
    } else {
        openLocaleDropdown();
    }
}

function initLocaleDropdown() {
    const dropdown = document.getElementById('locale-dropdown');
    const trigger = document.getElementById('locale-dropdown-trigger');
    const menu = document.getElementById('locale-dropdown-menu');
    if (!dropdown || !trigger || !menu) {
        return;
    }

    trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleLocaleDropdown();
    });

    menu.addEventListener('click', (event) => {
        event.stopPropagation();
        const option = event.target.closest('.locale-dropdown-option');
        if (!option) {
            return;
        }
        const locale = option.dataset.locale;
        if (locale && locale !== shared().currentLocale) {
            setLocale(locale);
        }
        closeLocaleDropdown();
    });

    document.addEventListener('click', () => closeLocaleDropdown());
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeLocaleDropdown();
        }
    });
}

function setLocale(value) {
    shared().vscode.postMessage({ type: 'setLocale', locale: value });
}
window.setLocale = setLocale;

window.dotenvyPanelLocale = {
    renderMenu: renderLocaleMenu,
    sync: syncLocaleDropdown,
    init: initLocaleDropdown,
    setLocale: setLocale,
};
