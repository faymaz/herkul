// prefs.js
import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export default class Prefs extends GObject.Object {
    static {
        GObject.registerClass(this);
    }

    constructor(metadata) {
        super();
        this._metadata = metadata;
    }

    fillPreferencesWindow(window) {
        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: 'Prayer Times Settings',
            icon_name: 'preferences-system-time-symbolic',
        });

        // Create a preferences group for notifications
        const notifyGroup = new Adw.PreferencesGroup({
            title: 'Notifications',
            description: 'Configure notification settings'
        });

        // Add notification settings
        const notifySwitch = new Adw.ActionRow({
            title: 'Enable Notifications',
            subtitle: 'Show notifications before prayer times'
        });

        const notifyToggle = new Gtk.Switch({
            active: true,
            valign: Gtk.Align.CENTER,
        });

        notifySwitch.add_suffix(notifyToggle);
        notifyGroup.add(notifySwitch);

        // Add sound settings
        const soundSwitch = new Adw.ActionRow({
            title: 'Enable Sound',
            subtitle: 'Play sound with notifications'
        });

        const soundToggle = new Gtk.Switch({
            active: true,
            valign: Gtk.Align.CENTER,
        });

        soundSwitch.add_suffix(soundToggle);
        notifyGroup.add(soundSwitch);

        // Add the notification group to the page
        page.add(notifyGroup);

        // Create a preferences group for cities
        const citiesGroup = new Adw.PreferencesGroup({
            title: 'Default City',
            description: 'Select default city for prayer times'
        });

        // Try to load cities from cities.json
        try {
            const citiesPath = GLib.build_filenamev([this._metadata.path, 'cities.json']);
            const [success, contents] = GLib.file_get_contents(citiesPath);
            
            if (success) {
                const citiesData = JSON.parse(new TextDecoder().decode(contents));
                const cityNames = citiesData.cities.map(city => city.name);

                const defaultCityRow = new Adw.ComboRow({
                    title: 'Default City',
                    model: new Gtk.StringList({
                        strings: cityNames
                    })
                });

                citiesGroup.add(defaultCityRow);
            }
        } catch (error) {
            log(`Error loading cities: ${error}`);
            
            // Add a label to show the error
            const errorLabel = new Gtk.Label({
                label: 'Error loading cities list',
                css_classes: ['error']
            });
            citiesGroup.add(errorLabel);
        }

        // Add the cities group to the page
        page.add(citiesGroup);

        // Add the page to the window
        window.add(page);

        // Load and apply any saved settings
        this._loadSettings();
    }

    _loadSettings() {
        try {
            // Load saved settings if they exist
            const settingsPath = GLib.build_filenamev([this._metadata.path, 'settings.json']);
            const [success, contents] = GLib.file_get_contents(settingsPath);
            
            if (success) {
                const settings = JSON.parse(new TextDecoder().decode(contents));
                // Apply loaded settings here
                log('[PrayerTimes] Settings loaded successfully');
            }
        } catch (error) {
            log(`[PrayerTimes] Error loading settings: ${error}`);
        }
    }
}