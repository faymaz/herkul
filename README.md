![Visitor Count](https://visitor-badge.laobi.icu/badge?page_id=faymaz.herkul) 

# Herkul GNOME Shell Uzantısı

Herkul, GNOME masaüstü ortamı için geliştirilmiş bir shell uzantısıdır. Bu uzantı, Diyanet İşleri Başkanlığı'nın web sitesinden namaz vakitlerini gösterir, hava durumu bilgisi sunar ve Herkul radyosunu dinleme imkanı sunar.


## Herkul

**Author:** [faymaz](https://github.com/faymaz)


![herkul - 1](img/herkul_1.png)

![herkul - 2](img/herkul_2.png)

![herkul - Configuration Menu](img/config_menu.png)


## Özellikler

- 🕌 Diyanet'in web sitesinden güncel namaz vakitleri
- 🌍 Birçok şehir için destek (Türkiye, Almanya, ABD, İngiltere vb.)
- 🌤️ OpenWeatherMap üzerinden güncel hava durumu bilgileri
- 🔔 Namaz vakti yaklaştığında bildirim sistemi
- 🎵 Entegre Herkul Radyo yayını (https://herkul.org/)
- 🎨 GNOME Shell temasıyla uyumlu görünüm
- 🔄 Otomatik güncellenen vakitler
- ⚙️ Özelleştirilebilir ayarlar
- 💾 Akıllı önbellekleme sistemi (WAF engellerine karşı koruma)

## Gereksinimler

- GNOME Shell 45, 46, 47, 48 veya 49
- GStreamer (ses çalma özelliği için)
- İnternet bağlantısı
- [OpenWeatherMap](https://home.openweathermap.org) API anahtarı (hava durumu için) sayfasına üye olup [apikey](https://home.openweathermap.org/api_keys) alabilirsiniz.

## Kurulum

### Manuel Kurulum

1. Bu repoyu klonlayın:
```bash
git clone https://github.com/faymaz/herkul.git
```

2. Uzantı klasörüne kopyalayın:
```bash
cp -r herkul ~/.local/share/gnome-shell/extensions/herkul@faymaz.github.com
```

3. GNOME Shell'i yeniden başlatın (X11'de Alt+F2, r, Enter veya oturumu kapatıp açın)

4. GNOME Uzantılar uygulamasından uzantıyı etkinleştirin

### Extensions.gnome.org Üzerinden Kurulum

1. [extensions.gnome.org](https://extensions.gnome.org) adresini ziyaret edin
2. "Herkul" uzantısını arayın
3. Uzantı sayfasındaki düğmeyi kullanarak kurulumu yapın
4. Şayet bulamazsanız [Herkul GNOME Shell Uzantısı](https://extensions.gnome.org/extension/7810/herkul/)

## Kullanım

Uzantı kurulduktan sonra, GNOME Shell'in üst panelinde bir simge görünecektir. Bu simgeye tıkladığınızda:

- Güncel namaz vakitleri
- Bir sonraki namaz vaktine kalan süre
- Şehir seçim menüsü
- Herkul radyo açma/kapama düğmesi

görüntülenecektir.

### Ayarlar

Uzantı ayarlarına erişmek için:

1. GNOME Uzantılar uygulamasını açın
2. Herkul uzantısının yanındaki ayarlar (⚙️) simgesine tıklayın

Ayarlarda şunları özelleştirebilirsiniz:
- Varsayılan şehir seçimi
- Bildirimler ve ses ayarları
- Önbellek süresi (Anlık / Günlük / Haftalık / Aylık / Yıllık)
- OpenWeatherMap API anahtarı

## Desteklenen Şehirler

- 🇹🇷 Türkiye: İstanbul, Ankara
- 🇩🇪 Almanya: Berlin, Stuttgart
- 🇺🇸 ABD: Clifton, Costa Mesa, Irvine
- 🇬🇧 İngiltere: Londra

## Yeni Şehir Ekleme

Yeni şehirler eklemek istiyorsanız, `cities.json` dosyasını düzenleyebilirsiniz:

```json
{
  "cities": [
    { "name": "İstanbul", "url": "https://namazvakitleri.diyanet.gov.tr/tr-TR/9206/ankara-icin-namaz-vakti/tr-TR/9541/prayer-time-for-istanbul", "weatherId": "745044" },
    { "name": "Ankara", "url": "https://namazvakitleri.diyanet.gov.tr/tr-TR/9206/ankara-icin-namaz-vakti/tr-TR/9206/prayer-time-for-ankara", "weatherId": "323786" },
    //
    // Daha fazla şehir ekleyebilirsiniz...
    //
    { "name": "Medine", "url": "https://namazvakitleri.diyanet.gov.tr/tr-TR/9206/ankara-icin-namaz-vakti/tr-TR/16308/medine-icin-namaz-vakti", "weatherId": "109223" },
    { "name": "Mekke", "url": "https://namazvakitleri.diyanet.gov.tr/tr-TR/9206/ankara-icin-namaz-vakti/tr-TR/16309/mekke-icin-namaz-vakti", "weatherId": "104515" }
  ]
}
```

**Not:** Eklediğiniz URL'lerin Diyanet İşleri resmi web sitesindeki doğru sayfalara yönlendirildiğinden emin olun ve weatherId bilgilerinide https://home.openweathermap.org adresinden şehir isimleri bağlantılarından görebilirsiniz. örn. Köln için Cologne, DE sayfasına gidince https://openweathermap.org/city/2886242
{ "name": "Köln", "url": "https://namazvakitleri.diyanet.gov.tr/tr-TR/9206/ankara-icin-namaz-vakti/tr-TR/11019/koln-icin-namaz-vakti", "weatherId": "2886242" },


## Sorun Giderme

### 1. Namaz vakitleri yüklenmiyor

Diyanet'in web sitesi zaman zaman otomatik bot koruması (WAF — Web Application Firewall) devreye girerek bağlantıları engelleyebilir. Bu durum özellikle hafta sonları ve yoğun trafik dönemlerinde daha sık yaşanabilir.

**Çözüm: Önbellek süresini artırın**

Uzantı ayarlarını açın → **Gelişmiş** sekmesi → **Önbellek Süresi** → **Yıllık** seçin.

| Önbellek Ayarı | Açıklama |
|---|---|
| Anlık | Her güncellemede Diyanet'ten canlı çeker (engellenme riski yüksek) |
| Günlük | Gün boyunca önbellekten okur |
| Haftalık | 7 günlük veri önbellekte tutulur |
| Aylık | 30 günlük veri önbellekte tutulur |
| **Yıllık** (önerilen) | Yıl sonuna kadar tüm vakitler yerel diskte saklanır, Diyanet'e bağlantı gerektirmez |

Yıllık önbellek seçildiğinde vakitler `~/.cache/herkul-prayer-cache.json` dosyasına kaydedilir. Bir kez başarılı bağlantı kurulduktan sonra WAF engellerinden bağımsız olarak çalışmaya devam eder.

> **Not:** Önbellek dosyası bozulursa veya yenilemek istiyorsanız dosyayı silin, uzantı otomatik olarak yeniden indirecektir:
> ```bash
> rm ~/.cache/herkul-prayer-cache.json
> ```

### 2. Ses çalışmıyor
   - GStreamer'ın kurulu olduğundan emin olun
   - Sistem ses ayarlarını kontrol edin

### 3. Hava durumu görünmüyor
   - OpenWeatherMap API anahtarının doğru girildiğinden emin olun
   - İnternet bağlantınızı kontrol edin


## Geliştirme

Projeye katkıda bulunmak istiyorsanız:

1. Bu repoyu fork edin
2. Yeni bir branch oluşturun (`git checkout -b yeni-ozellik`)
3. Değişikliklerinizi commit edin (`git commit -am 'Yeni özellik: XYZ'`)
4. Branch'inizi push edin (`git push origin yeni-ozellik`)
5. Pull Request oluşturun

## İletişim

- GitHub: [@faymaz](https://github.com/faymaz)

