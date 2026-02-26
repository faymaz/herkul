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

        // Sekme 1: Genel
        const generalPage = new Adw.PreferencesPage({
            title: _('Genel'),
            icon_name: 'preferences-system-symbolic',
        });
        generalPage.add(this._createCityGroup(settings));
        window.add(generalPage);

        // Sekme 2: Bildirimler
        const notifyPage = new Adw.PreferencesPage({
            title: _('Bildirimler'),
            icon_name: 'preferences-system-notifications-symbolic',
        });
        notifyPage.add(this._createNotificationGroup(settings));
        window.add(notifyPage);

        // Sekme 3: Radyo
        const radioPage = new Adw.PreferencesPage({
            title: _('Radyo'),
            icon_name: 'audio-x-generic-symbolic',
        });
        radioPage.add(this._createRadioGroup(settings));
        window.add(radioPage);

        // Sekme 4: Gelişmiş
        const advancedPage = new Adw.PreferencesPage({
            title: _('Gelişmiş'),
            icon_name: 'preferences-other-symbolic',
        });
        advancedPage.add(this._createWeatherGroup(settings));
        advancedPage.add(this._createCacheGroup(settings));
        advancedPage.add(this._createDebugGroup(settings));
        window.add(advancedPage);
    }
    
    _createRadioGroup(settings) {
        const radioGroup = new Adw.PreferencesGroup({
            title: _('Radyo Ayarları'),
            description: _('Varsayılan radyo istasyonunu seçin')
        });
        
       
        const radioStations = [
            { id: 'herkul', name: _("Herkul Radyo") },
            { id: 'cihan', name: _("Cihan Radyo") },
            { id: 'sadecemuzik', name: _("Sadece Müzik") }
        ];
        
        const stationNames = radioStations.map(station => station.name);
        const stationIds = radioStations.map(station => station.id);
        
        const defaultStationRow = new Adw.ComboRow({
            title: _('Varsayılan Radyo İstasyonu'),
            model: new Gtk.StringList({
                strings: stationNames
            })
        });
        
       
        const currentStation = settings.get_string('current-station');
        const stationIndex = stationIds.indexOf(currentStation);
        if (stationIndex !== -1) {
            defaultStationRow.selected = stationIndex;
        }
        
       
        defaultStationRow.connect('notify::selected', (widget) => {
            const selectedId = stationIds[widget.selected];
            settings.set_string('current-station', selectedId);
        });
        
        radioGroup.add(defaultStationRow);
        return radioGroup;
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


        const soundFiles = [
            { id: 'call.mp3', name: _("Ayine Ses 1 (call.mp3)") },
            { id: 'call_1.mp3', name: _("Davud Ses 2 (call_1.mp3)") }
        ];

        const soundFileNames = soundFiles.map(sound => sound.name);
        const soundFileIds = soundFiles.map(sound => sound.id);

        const notificationSoundRow = new Adw.ComboRow({
            title: _('Bildirim Sesi'),
            subtitle: _('Bildirimler için kullanılacak ses dosyasını seçin'),
            model: new Gtk.StringList({
                strings: soundFileNames
            })
        });


        const currentSound = settings.get_string('notification-sound');
        const soundIndex = soundFileIds.indexOf(currentSound);
        if (soundIndex !== -1) {
            notificationSoundRow.selected = soundIndex;
        }


        notificationSoundRow.connect('notify::selected', (widget) => {
            const selectedId = soundFileIds[widget.selected];
            settings.set_string('notification-sound', selectedId);
        });

        notifyGroup.add(notificationSoundRow);

        const ezanSwitch = new Adw.ActionRow({
            title: _('Vakit girdiğini belirten sesli uyarı'),
            subtitle: _('Namaz vakti girince sesli bildir')
        });
        const ezanToggle = new Gtk.Switch({
            active: settings.get_boolean('ezan-enabled'),
            valign: Gtk.Align.CENTER,
        });
        ezanToggle.connect('notify::active', (widget) => {
            settings.set_boolean('ezan-enabled', widget.get_active());
        });
        ezanSwitch.add_suffix(ezanToggle);
        notifyGroup.add(ezanSwitch);


        return notifyGroup;
    }

    _createDebugGroup(settings) {
        const debugGroup = new Adw.PreferencesGroup({
            title: _('Geliştirici'),
            description: _('Geliştirici seçenekleri')
        });
        const debugSwitch = new Adw.ActionRow({
            title: _('Debug Modunu Etkinleştir'),
            subtitle: _('Debug loglarını journalctl çıktısında göster')
        });
        const debugToggle = new Gtk.Switch({
            active: settings.get_boolean('debug-enabled'),
            valign: Gtk.Align.CENTER,
        });
        debugToggle.connect('notify::active', (widget) => {
            settings.set_boolean('debug-enabled', widget.get_active());
        });
        debugSwitch.add_suffix(debugToggle);
        debugGroup.add(debugSwitch);
        return debugGroup;
    }
    
    _createCacheGroup(settings) {
        const cacheGroup = new Adw.PreferencesGroup({
            title: _('Namaz Vakitleri Önbelleği'),
            description: _('Diyanet\'ten alınan vakitlerin ne kadar süre saklanacağını seçin')
        });

        const cacheOptions = [
            { id: 'instant',  name: _('Anlık — Her güncellemede Diyanet\'ten al (önbelleksiz)') },
            { id: 'daily',    name: _('Günlük — Gün boyunca önbellekte tut') },
            { id: 'weekly',   name: _('Haftalık — 7 günlük önbellek') },
            { id: 'monthly',  name: _('Aylık — 30 günlük önbellek') },
            { id: 'yearly',   name: _('Yıllık — Yıl sonuna kadar önbellekte tut (önerilen)') },
        ];

        const cacheRow = new Adw.ComboRow({
            title: _('Önbellek Süresi'),
            subtitle: _('Uzun süre seçmek WAF engellerine karşı koruma sağlar'),
            model: new Gtk.StringList({ strings: cacheOptions.map(o => o.name) })
        });

        const currentDuration = settings.get_string('cache-duration');
        const idx = cacheOptions.findIndex(o => o.id === currentDuration);
        if (idx !== -1) cacheRow.selected = idx;

        cacheRow.connect('notify::selected', (widget) => {
            settings.set_string('cache-duration', cacheOptions[widget.selected].id);
        });

        cacheGroup.add(cacheRow);
        return cacheGroup;
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

               
                const allCities = [];
                citiesData.cities.forEach(countryGroup => {
                    if (countryGroup.cities && Array.isArray(countryGroup.cities)) {
                        countryGroup.cities.forEach(city => {
                            allCities.push({
                                name: city.name,
                                country: countryGroup.country,
                                url: city.url,
                                weatherId: city.weatherId
                            });
                        });
                    }
                });

               
                const cityDisplayNames = allCities.map(city =>
                    `${city.name} (${city.country})`
                );

                const defaultCityRow = new Adw.ComboRow({
                    title: _('Varsayılan Şehir'),
                    model: new Gtk.StringList({
                        strings: cityDisplayNames
                    })
                });


                const currentCity = settings.get_string('default-city');
               
                const cityIndex = allCities.findIndex(city => city.name === currentCity);
                if (cityIndex !== -1) {
                    defaultCityRow.selected = cityIndex;
                }


                defaultCityRow.connect('notify::selected', (widget) => {
                    const selectedCity = allCities[widget.selected].name;
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