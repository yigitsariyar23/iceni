# Iceni

Spotify (Spicetify) için kişisel tema + extension seti.

## Yapı

```
color.ini    Tek renk şeması: [iceni] — Catppuccin Frappé temelli
user.css     Tema CSS'i
theme.js     Accent rengi seçici (Ayarlar sayfasına eklenir)
assets/      Accent'e göre equalizer GIF'leri
extensions/  Spicetify extension'ları (install.sh ile symlink'lenir)
scripts/     Vendor/bakım script'leri
vendor.lock  Pinlenen upstream sürümleri + sha256
```

## Kurulum

```bash
./install.sh      # symlink + spicetify config
spicetify apply   # Spotify'a uygula (Spotify'ı yeniden başlatır)
```

## Neden vendor'lıyoruz

Upstream Spicy Lyrics ve SpicyLyricTranslator **uzaktan kod yükler**:

- `spicy-lyrics`: `builds/spicy-lyrics.mjs` → jsDelivr `@main` → `api.spicylyrics.org/version`
  → `public.storage.spicylyrics.org/spicy-lyrics@<son sürüm>.mjs`
- `SLT`: `loader/SLT-loader.js` → `7xeh.dev`'den fetch + `<script>` enjeksiyonu,
  ayrıca 30 dakikada bir hotfix kontrolü ve gerekirse `window.location.reload()`

Sonuç: çalışan kod hiçbir zaman pinli değil ve git ile takip edilemiyordu.
Iceni bunun yerine kodu diske alır; sürüm ancak sen bilerek yükselttiğinde değişir.

Sürüm yükseltme:

```bash
./scripts/vendor-spicy-lyrics.sh --latest   # veya: ./scripts/vendor-spicy-lyrics.sh 6.4.0
spicetify apply
```

Bir şey bozulursa `git log` ve `vendor.lock` neyin ne zaman değiştiğini gösterir.

## Upstream kaynaklar

| Proje | Rol |
|---|---|
| [catppuccin/spicetify](https://github.com/catppuccin/spicetify) | Tema temeli (fork'landı, tek şemaya indirildi) |
| [Spikerko/spicy-lyrics](https://github.com/Spikerko/spicy-lyrics) | Lyrics motoru (pinlendi, CSS ile temalanıyor) |
| [7xeh/SpicyLyricTranslator](https://github.com/7xeh/SpicyLyricTranslator) | Çeviri katmanı |
