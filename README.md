# Devre Lab Simülatörü

Öğrencinin devreyi ekranda çizdiği, her bileşenin gerilim ve akımını tıklayarak gördüğü ve sonucu
PDF rapor olarak aldığı, tarayıcıda çalışan bir devre simülatörü. Kurulum gerektirmez; telefonda da açılır.
Hiçbir veri sunucuya gitmez.

## Özellikler

- **Bileşenler:** direnç (R), kapasitör (C), bobin (L), DC/AC gerilim kaynağı (V), DC/AC akım kaynağı (I),
  toprak (GND), ideal **voltmetre** (VM) ve **ampermetre** (AM).
- **Analizler:** DC, AC fazör (tek frekans + isteğe bağlı Bode taraması), geçici rejim (geri Euler / trapez).
- **Ölçüm:** bileşene tıklayınca gerilim, akım, güç (AC'de genlik ∠ faz, etkin değer, empedans; geçici rejimde
  seçilen andaki değer ve τ). Devre üzerinde düğüm gerilimi etiketleri ve seçili bileşenin akım yönü oku.
  İki nokta arası gerilim için voltmetre, dal akımı için seri ampermetre eklenebilir.
- **Lab:** ölçülen V / I değerini girince yüzde hata; **Çözümü göster** modunda netlist ve MNA matrisi
  (seçili bileşenin damgası renkli).
- **Rapor:** başlık bloğu, vektör devre şeması, analiz ayarları, sonuç tablosu (ölçülen + % hata),
  düğüm gerilimleri, grafikler ve isteğe bağlı MNA eki içeren A4 PDF. Yalnızca şema: PDF / SVG / PNG.
- **Dosya:** `.devre` (JSON) indir / aç, tarayıcıda otomatik taslak, hazır örnek devreler.
- **Düzenleme:** sürükle-bırak, pinden ya da mevcut bir kablodan sürükleyerek kablo (bileşenlerin üstünden geçmeyen otomatik yol), sol tuşla alan seçip toplu taşıma / silme (`Shift`+tık seçime ekler, `Ctrl+A` tümü), sağ tuşla sürükleyerek kaydırma, kenarlarından sürüklenerek boyutlandırılan paneller, döndürme (R), silme (Del), geri al / yinele (Ctrl+Z / Ctrl+Y).

## Kullanım

1. Paletten bileşenleri çizim alanına sürükleyin (ya da tıklayıp alana dokunun).
2. Bir pinden sürükleyerek veya `W` ile kablo çizin.
3. Bileşene çift tıklayıp değerini girin: `4k7`, `10m`, `100u`, `2.2n` gibi önekler kabul edilir.
4. En az bir toprak (GND) ekleyin, analiz türünü seçip **Çalıştır**'a basın (`F5` / `Ctrl+Enter`).
5. Bileşenlere tıklayıp değerleri okuyun; labda ölçtüğünüz değerleri girin.
6. **PDF rapor** ile çıktıyı indirin.

## Geliştirme

```bash
npm install
npm run dev        # geliştirme sunucusu
npm test           # Vitest: çözücü, netlist, birimler, dosya biçimi
npm run build      # dist/ klasörüne statik site
```

`dist/` klasörü GitHub Pages, Vercel ya da herhangi bir statik sunucuda yayınlanabilir (`base: './'`
olduğu için alt dizinde de çalışır).

## Mimari

```
src/
├── core/        circuit.ts (veri modeli) · netlist.ts (union-find) · units.ts · complex.ts · results.ts · examples.ts
├── solver/      lu.ts (kısmi pivotlu LU) · mna.ts (damgalar) · dc.ts · ac.ts · transient.ts · validate.ts
│                analyze.ts · worker.ts (Web Worker) · runner.ts · textNetlist.ts
├── state/       store.ts (Zustand, geri al / yinele)
├── storage/     project.ts (.devre, otomatik taslak)
├── report/      pdf.ts (jsPDF + svg2pdf + autotable) · schematicSvg.tsx
└── ui/          Canvas, Schematic, Palette, ResultPanel, Plots, SolutionView, ExportDialog, Toolbar
```

Çözücü React'tan bağımsız saf TypeScript'tir; arayüz yalnızca çizer ve gösterir. Ağır hesaplar Web
Worker'da çalışır. LU çözücü testlerde math.js `lusolve` ile karşılaştırılır.

**İşaret kuralı:** pasif işaret kuralı — akım bileşenin `+` ucundan girerse pozitiftir; güç veren kaynakların
gücü negatif çıkar. AC fazör genlikleri tepe değerdir; ölçülen değer ayarlardan etkin (RMS) ya da tepe
değerle karşılaştırılır.

**Bağlantı kuralı:** kablo bir pine yalnızca o pinde bittiğinde bağlanır; üstünden geçtiği pinlere bağlanmaz.
Bir kablonun ucu başka bir kablonun ortasında biterse T bağlantısı oluşur (nokta ile gösterilir).
Hiçbir şeye bağlı olmayan uçlar turuncu halkayla işaretlenir.
