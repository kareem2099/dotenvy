/** Shared i18n helpers for DotEnvy webview panels */
(function () {
    let currentStrings = {};
    let currentLocale = 'en';

    function tr(key, params) {
        params = params || {};
        let text = currentStrings[key] || key;
        for (const k of Object.keys(params)) {
            text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), String(params[k]));
        }
        return text;
    }

    function applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            const key = el.getAttribute('data-i18n');
            if (key) {
                el.textContent = tr(key);
            }
        });
        document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                el.title = tr(key);
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
