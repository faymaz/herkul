import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class HerkulPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create preferences page
        const page = new Adw.PreferencesPage({
            //title: 'Namaz Vakitleri Ayarları',
            title: 'Prayer Times Settings',
            icon_name: 'preferences-system-time-symbolic',
        });

        // Preferences group for notifications
        const notifyGroup = new Adw.PreferencesGroup({
            //title: 'Bildirimler',
		    //description: 'Bildirim ayarlarını yapılandır'
            title: 'Notifications',
            description: 'Configure notification settings'
        });

        // Add notification settings
        const notifySwitch = new Adw.ActionRow({
            //title: 'Bildirimleri Etkinleştir',
		    //subtitle: 'Namaz vakitlerinden önce bildirim göster'
            title: 'Enable Notifications',
            subtitle: 'Show notifications before prayer times'
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

        // Add sound settings
        const soundSwitch = new Adw.ActionRow({
            //title: 'Sesi Etkinleştir',
            //subtitle: 'Bildirimlerle birlikte ses çal'
            title: 'Enable Sound',
            subtitle: 'Play sound with notifications'
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

        page.add(notifyGroup);

        // Preferences group for cities
        const citiesGroup = new Adw.PreferencesGroup({
           //title: 'Varsayılan Şehir',
           //description: 'Namaz vakitleri için varsayılan şehri seçin'
            title: 'Default City',
            description: 'Select default city for prayer times'
        });

        try {
            const citiesPath = GLib.build_filenamev([this.path, 'cities.json']);
            const [success, contents] = GLib.file_get_contents(citiesPath);
            
            if (success) {
                const citiesData = JSON.parse(new TextDecoder().decode(contents));
                const cityNames = citiesData.cities.map(city => city.name);

                const defaultCityRow = new Adw.ComboRow({
                    //title: 'Varsayılan Şehir',
                    title: 'Default City',
                    model: new Gtk.StringList({
                        strings: cityNames
                    })
                });

                // Set current selected city
                const currentCity = settings.get_string('default-city');
                const cityIndex = cityNames.indexOf(currentCity);
                if (cityIndex !== -1) {
                    defaultCityRow.selected = cityIndex;
                }

                // Update settings when city changes
                defaultCityRow.connect('notify::selected', (widget) => {
                    const selectedCity = cityNames[widget.selected];
                    settings.set_string('default-city', selectedCity);
                });

                citiesGroup.add(defaultCityRow);
            }
        } catch (error) {
            //console.error('[PrayerTimes] Şehir listesi yüklenirken hata oluştu:', error);
            console.error('[PrayerTimes] Error loading city list:', error);
            const errorLabel = new Gtk.Label({
                //label: 'Şehir listesi yüklenirken hata oluştu',
                label: 'Error loading city list',
                css_classes: ['error']
            });
            citiesGroup.add(errorLabel);
        }

        page.add(citiesGroup);
        window.add(page);
    }
}