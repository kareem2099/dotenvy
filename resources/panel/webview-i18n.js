/** Shared i18n helpers for DotEnvy webview panels */
(function () {
    let currentStrings = {};
    let currentLocale = 'en';

    function tr(key, params, fallback) {
        params = params || {};
        let text = currentStrings[key] !== undefined ? currentStrings[key] : (fallback !== undefined ? fallback : key);
        for (const k of Object.keys(params)) {
            text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
        }
        return text;
    }

    function applyTranslations() {
        if (currentLocale === 'ar') {
            document.documentElement.setAttribute('dir', 'rtl');
            document.documentElement.setAttribute('lang', 'ar');
        } else {
            document.documentElement.setAttribute('dir', 'ltr');
            document.documentElement.setAttribute('lang', currentLocale || 'en');
        }
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            const key = el.getAttribute('data-i18n');
            if (key && currentStrings[key] !== undefined) {
                el.textContent = tr(key);
            }
        });
        document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
            const key = el.getAttribute('data-i18n-title');
            if (key && currentStrings[key] !== undefined) {
                el.title = tr(key);
            }
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key && currentStrings[key] !== undefined) {
                el.placeholder = tr(key);
            }
        });
    }

    function setLocalePayload(locale, strings) {
        if (strings) {
            currentStrings = strings;
        }
        if (locale) {
            currentLocale = locale;
        }
        applyTranslations();
    }

    window.dotenvyI18n = {
        tr: tr,
        applyTranslations: applyTranslations,
        setLocalePayload: setLocalePayload,
        handleMessage: function (message) {
            if (message.type === 'localeChanged') {
                setLocalePayload(message.locale, message.strings);
            }
        }
    };

    window.addEventListener('message', function (event) {
        window.dotenvyI18n.handleMessage(event.data);
    });
})();
