# Devre Lab Simülatörü

**Uygulamayı aç: https://realfoxxy.github.io/Devre-Uygulamas-/**

Öğrencinin devreyi ekranda çizdiği, her bileşenin gerilim ve akımını tıklayarak gördüğü ve sonucu
PDF rapor olarak aldığı, tarayıcıda çalışan bir devre simülatörü. Kurulum gerektirmez; telefonda da açılır.
Hiçbir veri sunucuya gitmez.

## Özellikler

- **Bileşenler:** direnç (R), kapasitör (C), bobin (L), DC/AC gerilim kaynağı (V), DC/AC akım kaynağı (I),
  toprak (GND), ideal **voltmetre** (VM) ve **ampermetre** (AM);
  bağımlı kaynaklar: GKGK/VCVS (E), AKGK/CCVS (H), GKAK/VCCS (G), AKAK/CCCS (F) — kontrol bileşeni listeden ya da çizimden seçilir.
- **Analizler:** DC, AC fazör (tek frekans + isteğe bağlı Bode taraması), geçici rejim (geri Euler / trapez).
- **Ölçüm:** bileşene tıklayınca gerilim, akım, güç (AC'de genlik ∠ faz, etkin değer, empedans; geçici rejimde
  seçilen andaki değer ve τ). Devre üzerinde düğüm gerilimi etiketleri ve seçili bileşenin akım yönü oku.
  İki nokta arası gerilim için voltmetre, dal akımı için seri ampermetre eklenebilir.
- **Analiz yöntemleri (Bölüm 3–4):** kabloya dokununca KAY tablosu, bileşende KGY çevresi; çoklu seçimde seri/paralel eşdeğer,
  gerilim ve akım bölücü formülleri; öğrencinin yazacağı biçimde düğüm denklemleri (süperdüğüm dahil) ve çevre denklemleri
  (süperçevre dahil, çizimde ↻ oklar); MATLAB, Python (NumPy), LaTeX ve SPICE (.cir) olarak kopyalama.
- **Teoremler (Bölüm 5):** kaynak dönüşümü (devrede uygulanır, öncesi/sonrası tablosu), süperpozisyon tablosu (güç
  toplanmaz notu), iki noktaya dokunarak Thevenin / Norton (R_th = 0, ∞ ve negatif durumları), eşdeğer direnç, maksimum güç
  (DC'de R_L taraması, AC'de Z_L = Z_th*).
- **Op-amp ve çok uçlu elemanlar (Bölüm 2.6–2.9, 6):** ideal, sonlu kazançlı ve ofsetli op-amp modeli (doyum, akım ve eğim hızı
  uyarıları, geri besleme yok hatası, ideale göre % fark); potansiyometre (kaydırıcı), sıcaklık sensörü, gerçek voltmetre /
  ampermetre (yükleme hatası), iki yollu anahtar.
- **Kaynak dalga biçimleri (Bölüm 1, 8, 9):** DC, AC, basamak, darbe / kare dalga, üstel, rampa, anahtarlanan sinüs, parçalı
  doğrusal (önizleme grafiğiyle); kırılma noktalarına hizalı zaman adımı, kenardan sonra geri Euler; iki imleç arasında enerji w = ∫p dt.
- **Anahtarlar ve birinci derece devreler (Bölüm 7–8):** zamanlı tek / iki yollu anahtar, otomatik başlangıç koşulu (t < 0 DC
  çözümü) ya da elle, 0⁻ / 0⁺ tablosu (sürekli / sıçrayan büyüklükler), depolanan enerji, her anahtarlama aralığı için
  x(t) = x(∞) + [x(t₀⁺) − x(∞)]e^(−(t−t₀)/τ) formülü (sinüs / üstel girişte doğal + zorlanmış), kararsızlık uyarısı,
  op-amp integral / türev alıcı tanıma.
- **İkinci derece devreler (Bölüm 9):** derece (bağımsız C + L; paralel C / seri L tek sayılır, C–V döngüsü ve L–I kesitlemesi
  tespiti), durum denklemleri, karakteristik denklem, α / ω₀, sönüm türü, seri / paralel RLC formülleri, s-düzlemi grafiği
  (direnç kaydırıcısıyla canlı kökler), zorlanmış yanıt (sabit, üstel, sinüs; çakışan giriş) ve tam yanıt formülü; formül
  eğrisi simülasyonla aynı grafikte.
- **Lab:** ölçülen V / I değerini girince yüzde hata; **Çözümü göster** modunda netlist ve MNA matrisi
  (seçili bileşenin damgası renkli).
- **Rapor:** kompakt A4 PDF — başlık bloğu, vektör devre şeması, analiz ayarları ve düğüm gerilimleri yan yana,
  sonuç tablosu (ölçülen + % hata), yan yana grafikler; isteğe bağlı bölümler: düğüm / çevre denklemleri,
  Thevenin–Norton kartı, süperpozisyon, birinci / ikinci derece analiz (s-düzlemi) ve MNA eki. Bölümler gereksiz
  yeni sayfa açmadan akar; basit bir DC devre tek sayfadır. Yalnızca şema: PDF / SVG / PNG.
- **Dosya:** `.devre` (JSON) indir / aç, tarayıcıda otomatik taslak; **Örnekler** menüsünde bölümlere göre
  gruplanmış ders kitabı örnekleri (temeller, analiz yöntemleri, teoremler, op-amp, birinci / ikinci derece).
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

## Lisans

Açık kaynak — [MIT Lisansı](LICENSE). Kullanabilir, değiştirebilir ve paylaşabilirsiniz.
