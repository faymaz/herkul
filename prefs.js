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
            title: _('Namaz Vakitleri Ayarları'),
            icon_name: 'preferences-system-time-symbolic',
        });
        const cityGroup = this._createCityGroup(settings);
        const weatherGroup = this._createWeatherGroup(settings);
    
        const notifyGroup = this._createNotificationGroup(settings);
        page.add(cityGroup);
        page.add(weatherGroup);
        page.add(notifyGroup);
        page.add(langGroup);
        window.add(page);
    }
    _createWeatherGroup(settings) {
        const weatherGroup = new Adw.PreferencesGroup({
            title: _('Hava Durumu Ayarları'),
            description: _('OpenWeatherMap ayarlarını yapılandır')
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
    _createNotificationGroup(settings) {
        const notifyGroup = new Adw.PreferencesGroup({
            title: _('Bildirimleri Etkinleştir'),
            description: _('Bildirim ayarlarını yapılandırın')
        });
        const notifySwitch = new Adw.ActionRow({
            title: _('Bildirimleri Etkinleştir'),
            subtitle: _('Namaz vakitlerinden önce bildirim göster')
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
            title: _('Sesi Etkinleştir'),
            subtitle: _('Bildirimlerle birlikte ses çal')
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
    _createCityGroup(settings) {
        const citiesGroup = new Adw.PreferencesGroup({
            title: _('Varsayılan Şehir'),
            description: _('Namaz vakti için varsayılan şehri seçin')
        });

        try {
            const citiesPath = GLib.build_filenamev([this.path, 'cities.json']);
            const [success, contents] = GLib.file_get_contents(citiesPath);
            
            if (success) {
                const citiesData = JSON.parse(new TextDecoder().decode(contents));
                const cityNames = citiesData.cities.map(city => city.name);

                const defaultCityRow = new Adw.ComboRow({
                    title: _('Varsayılan Şehir'),
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
            console.error('Şehir listesi yüklenirken hata oluştu:', error);
            const errorLabel = new Gtk.Label({
                label: _('Error loading city list'),
                css_classes: ['error']
            });
            citiesGroup.add(errorLabel);
        }

        return citiesGroup;
    }
}