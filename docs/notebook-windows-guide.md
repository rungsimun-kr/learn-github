# คู่มือเช็กระบบและตั้งค่าโน้ตบุ๊ก (Windows)

คู่มือนี้รวมวิธี **เช็กระบบภายในเครื่อง** และ **ตั้งค่าที่ใช้บ่อย** สำหรับโน้ตบุ๊กที่ใช้ Windows 10 / 11
เขียนแบบทำตามได้ทีละขั้น เหมาะกับคนที่อยากดูแลเครื่องเองเบื้องต้น

> เคล็ดลับ: หลายคำสั่งต้องเปิดหน้าต่างแบบ **Run as administrator**
> วิธีเปิด: กดปุ่ม Start → พิมพ์ `cmd` หรือ `PowerShell` → คลิกขวา → **Run as administrator**

---

## 1. แก้ปัญหาจอดับเอง ทั้งที่ตั้งไม่ให้ดับ

Windows มี "เวลาปิดจอ" ซ่อนอยู่หลายที่ ต้องไล่ปิดให้ครบทุกจุด ไม่ใช่แค่จุดเดียว

### 1.1 ตั้งค่าพลังงานหลัก
`Settings > System > Power & battery > Screen and sleep`
- ตั้ง **Screen** (ปิดจอ) เป็น **Never**
- ตั้ง **Sleep** (เข้าโหมดหลับ) เป็น **Never**
- ทำทั้ง 2 เงื่อนไข: *On battery power* (ใช้แบต) และ *When plugged in* (เสียบปลั๊ก)

### 1.2 ปิด Screen Saver
กด `Win + R` แล้วพิมพ์:
```
control desk.cpl,,@screensaver
```
ถ้า Screen saver เปิดอยู่ ให้เปลี่ยนเป็น **(None)** แล้วกด Apply

### 1.3 ค่าซ่อนใน Power Plan (สำคัญ มักถูกลืม)
กด `Win + R` แล้วพิมพ์:
```
control powercfg.cpl
```
เลือกแผนพลังงานที่ใช้ → **Change plan settings** → **Change advanced power settings** แล้วเช็ก:
- **Display > Turn off display after** → ตั้งเป็น `0` (Never) หรือค่าที่ต้องการ
- **Sleep > Sleep after** → `0` (Never)
- **Sleep > System unattended sleep timeout** → ถ้ามี ให้ตั้งค่าให้ยาวขึ้น (ค่านี้ทำให้เครื่องหลับเองแม้ตั้ง Never)

### 1.4 ปิดเซนเซอร์ตรวจจับคน (Presence Sensing)
โน้ตบุ๊กรุ่นใหม่บางรุ่น (เช่น Dell, Lenovo บางรุ่น) จะ **ดับจอเมื่อกล้องไม่เห็นหน้าเรา**
`Settings > Privacy & security > Presence sensing` → ปิดออปชันที่เกี่ยวกับ dim/turn off screen

### 1.5 ปิด Adaptive/Battery Saver ที่หรี่จอ
`Settings > System > Power & battery > Battery saver`
- ตั้งให้เปิดเฉพาะเมื่อแบตต่ำมาก หรือปิดออปชัน *Lower screen brightness when using battery saver*

### 1.6 เช็กว่าอะไรกำลังสั่งให้เครื่องหลับ/ตื่น
เปิด Command Prompt (Admin) แล้วรัน:
```cmd
powercfg /requests
powercfg /lastwake
powercfg /waketimers
```
- `/requests` = แอป/ไดรเวอร์ที่ขอควบคุมการหลับอยู่ตอนนี้
- `/lastwake` = อะไรทำให้เครื่องตื่นครั้งล่าสุด
- `/waketimers` = ตัวตั้งเวลาที่จะปลุกเครื่อง

### 1.7 แอปจัดการพลังงานของแบรนด์เครื่อง
แอปเหล่านี้มักมีตัวตั้งเวลาปิดจอที่ **ทับค่าของ Windows**:
- Lenovo → **Lenovo Vantage**
- Dell → **Dell Power Manager**
- ASUS → **MyASUS**
- HP → **HP Support Assistant / HP Command Center**

ถ้ายังดับเองอยู่ ให้เข้าไปปิดออปชันประหยัดพลังงาน/ปิดจอในแอปเหล่านี้ด้วย

### 1.8 อัปเดตไดรเวอร์การ์ดจอ
ไดรเวอร์กราฟิกเก่า (โดยเฉพาะ Intel) มีฟีเจอร์ *Display Power Saving / Panel Self Refresh* ที่หรี่-ดับจอเอง
อัปเดตผ่าน Windows Update หรือเว็บผู้ผลิต (Intel / NVIDIA / AMD)

---

## 2. เช็กสเปกและข้อมูลระบบ

| อยากดู | วิธีเปิด | คำสั่ง / ที่อยู่ |
|--------|---------|------------------|
| สเปกโดยรวม | `Win + R` | `msinfo32` (System Information) |
| สเปกแบบย่อ | Settings | `Settings > System > About` |
| สรุปทางคอมมานด์ | CMD | `systeminfo` |
| จอ/การ์ดจอ/เสียง | `Win + R` | `dxdiag` (DirectX Diagnostic) |
| CPU/RAM/ดิสก์แบบเรียลไทม์ | `Ctrl + Shift + Esc` | Task Manager → แท็บ Performance |

---

## 3. เช็กสุขภาพแบตเตอรี่

สร้างรายงานแบตเตอรี่แบบละเอียด — เปิด CMD (Admin) แล้วรัน:
```cmd
powercfg /batteryreport /output "%USERPROFILE%\Desktop\battery-report.html"
```
จะได้ไฟล์ `battery-report.html` บนหน้า Desktop เปิดด้วยเบราว์เซอร์ ดูค่าสำคัญ:
- **Design Capacity** = ความจุตอนออกจากโรงงาน
- **Full Charge Capacity** = ความจุจริงตอนนี้
- ถ้า Full Charge เหลือน้อยกว่า Design มาก = แบตเสื่อม ควรพิจารณาเปลี่ยน

รายงานการใช้พลังงาน/ปัญหา sleep:
```cmd
powercfg /energy
```

เช็กว่าเครื่องรองรับโหมดหลับแบบไหน:
```cmd
powercfg /a
```

---

## 4. เช็กสุขภาพฮาร์ดดิสก์ / SSD

ดูรายชื่อไดรฟ์และสถานะเบื้องต้น (PowerShell):
```powershell
Get-PhysicalDisk | Select-Object FriendlyName, MediaType, HealthStatus, OperationalStatus
```

ตรวจ error ระบบไฟล์ (แทน `C:` ด้วยไดรฟ์ที่ต้องการ):
```cmd
chkdsk C: /scan
```
> `chkdsk C: /f` จะซ่อม แต่ต้องรีสตาร์ตและใช้เวลานาน ทำเมื่อจำเป็น

---

## 5. เช็กแรม (RAM)

ตัวตรวจหน่วยความจำในตัว Windows — กด `Win + R` พิมพ์:
```
mdsched
```
เลือก *Restart now and check for problems* เครื่องจะรีสตาร์ตแล้วทดสอบแรม

---

## 6. ซ่อมไฟล์ระบบที่เสียหาย

ถ้าเครื่องมีอาการแปลก ๆ (ค้าง เด้ง จอวูบ) ลองซ่อมไฟล์ระบบ — CMD (Admin):
```cmd
sfc /scannow
DISM /Online /Cleanup-Image /RestoreHealth
```
รัน `sfc /scannow` ก่อน ถ้ายังไม่หายค่อยรัน DISM แล้วรัน `sfc` ซ้ำอีกครั้ง

---

## 7. เช็กความเสถียร / ประวัติปัญหา

ดูไทม์ไลน์ปัญหา (แครช ค้าง อัปเดตล้มเหลว) — กด `Win + R` พิมพ์:
```
perfmon /rel
```
(Reliability Monitor) เห็นเป็นกราฟรายวัน คลิกดูรายละเอียดของแต่ละเหตุการณ์ได้

---

## 8. เช็กลิสต์รวม (Checklist)

- [ ] ตั้ง Screen / Sleep เป็น Never ทั้งตอนใช้แบตและเสียบปลั๊ก (ข้อ 1.1)
- [ ] ปิด Screen saver (ข้อ 1.2)
- [ ] เช็กค่าซ่อนใน advanced power settings (ข้อ 1.3)
- [ ] ปิด Presence sensing ถ้ามี (ข้อ 1.4)
- [ ] รัน `powercfg /requests` ดูว่าอะไรสั่งหลับ (ข้อ 1.6)
- [ ] เช็กแอปพลังงานของแบรนด์เครื่อง (ข้อ 1.7)
- [ ] สร้าง battery report เช็กสุขภาพแบต (ข้อ 3)

---

*หมายเหตุ: เมนูและชื่อออปชันอาจต่างกันเล็กน้อยตามเวอร์ชัน Windows และรุ่นเครื่อง หากหาไม่เจอให้ใช้ช่องค้นหาใน Settings พิมพ์คำที่เกี่ยวข้อง เช่น "power", "sleep", "screen"*
