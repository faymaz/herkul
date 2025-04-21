import {ExtensionPreferences, gettext as _, ngettext} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export default class HerkulPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        const settings = this.getSettings();
        this._bindTextDomain();
        const page = new Adw.PreferencesPage({
            title: _('Prayer Times Settings'),
            icon_name: 'preferences-system-time-symbolic',
        });
        const cityGroup = this._createCityGroup(settings);
        const weatherGroup = this._createWeatherGroup(settings);
        const langGroup = this._createLanguageGroup(settings);
        const notifyGroup = this._createNotificationGroup(settings);
        page.add(cityGroup);
        page.add(weatherGroup);
        page.add(notifyGroup);
        page.add(langGroup);
        window.add(page);
    }
    _createWeatherGroup(settings) {
        const weatherGroup = new Adw.PreferencesGroup({
            title: _('Weather Settings'),
            description: _('Configure OpenWeatherMap settings')
        });
        const apiKeyRow = new Adw.EntryRow({
            title: _('API Key'),
            text: settings.get_string('apikey')
        });
        apiKeyRow.connect('changed', entry => {
            settings.set_string('apikey', entry.get_text());
        });
        weatherGroup.add(apiKeyRow);
        return weatherGroup;
    }
    _createLanguageGroup(settings) {
        const langGroup = new Adw.PreferencesGroup({
            title: _('Language'),
            description: _('Select interface language')
        });
        const languages = [
            { id: 'en', name: 'English' },
            { id: 'tr', name: 'Türkçe' },
            { id: 'de', name: 'Deutsch' },
            { id: 'ar', name: 'العربية' }
        ];
        const langRow = new Adw.ComboRow({
            title: _('Interface Language'),
            model: new Gtk.StringList({
                strings: languages.map(lang => lang.name)
            })
        });
        const currentLang = settings.get_string('language');
        const langIndex = languages.findIndex(lang => lang.id === currentLang);
        if (langIndex !== -1) {
            langRow.selected = langIndex;
        }
        langRow.connect('notify::selected', (widget) => {
            const selectedLang = languages[widget.selected].id;
            settings.set_string('language', selectedLang);
            this._loadTranslations(selectedLang);
        });
        langGroup.add(langRow);
        return langGroup;
    }
    _createNotificationGroup(settings) {
        const notifyGroup = new Adw.PreferencesGroup({
            title: _('Notifications'),
            description: _('Configure notification settings')
        });
        const notifySwitch = new Adw.ActionRow({
            title: _('Enable Notifications'),
            subtitle: _('Show notifications before prayer times')
        });
        const notifyToggle = new Gtk.Switch({
            active: settings.get_boolean('notify-enabled'),
            valign: Gtk.Align.CENTER,
        });
        notifyToggle.connect('notify::active', (widget) => {
            settings.set_boolean('notify-enabled', widget.get_active());
        });
        notifySwitch.add_suffix(notifyToggle);
        notifyGroup.add(notifySwitch);
        const soundSwitch = new Adw.ActionRow({
            title: _('Enable Sound'),
            subtitle: _('Play sound with notifications')
        });
        const soundToggle = new Gtk.Switch({
            active: settings.get_boolean('sound-enabled'),
            valign: Gtk.Align.CENTER,
        });
        soundToggle.connect('notify::active', (widget) => {
            settings.set_boolean('sound-enabled', widget.get_active());
        });
        soundSwitch.add_suffix(soundToggle);
        notifyGroup.add(soundSwitch);
        return notifyGroup;
    }
    
   
   
   
   
   
   
   
   
   
   
   

   
   
   
        
   
   
   
   
    _bindTextDomain() {
        let localeDir = GLib.build_filenamev([this.path, 'locale']);
        let currentLang = this.getSettings().get_string('language');
        GLib.setenv('LANGUAGE', currentLang, true);
    }
    
    _loadTranslations(locale) {
        GLib.setenv('LANGUAGE', locale, true);
        this._window.set_title(_('Prayer Times Settings'));
    }
    _createCityGroup(settings) {
        const citiesGroup = new Adw.PreferencesGroup({
            title: _('Default City'),
            description: _('Select default city for prayer times')
        });

        try {
            const citiesPath = GLib.build_filenamev([this.path, 'cities.json']);
            const [success, contents] = GLib.file_get_contents(citiesPath);
    if (success) {
                const citiesData = JSON.parse(new TextDecoder().decode(contents));
                const cityNames = citiesData.cities.map(city => city.name);

                const defaultCityRow = new Adw.ComboRow({
                    title: _('Default City'),
                    model: new Gtk.StringList({
                        strings: cityNames
                    })
                });

           const currentCity = settings.get_string('default-city');
                const cityIndex = cityNames.indexOf(currentCity);
                if (cityIndex !== -1) {
                    defaultCityRow.selected = cityIndex;
                }

           defaultCityRow.connect('notify::selected', (widget) => {
                    const selectedCity = cityNames[widget.selected];
                    settings.set_string('default-city', selectedCity);
                });

                citiesGroup.add(defaultCityRow);
            }
        } catch (error) {
            console.error('[PrayerTimes] Error loading city list:', error);
            const errorLabel = new Gtk.Label({
                label: _('Error loading city list'),
                css_classes: ['error']
            });
            citiesGroup.add(errorLabel);
        }

        return citiesGroup;
    }
}