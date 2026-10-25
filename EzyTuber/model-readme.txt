=====================================================================
 CÁCH THÊM MODEL CHO EZY TUBER
=====================================================================
CÁCH NHANH NHẤT: mở Cài đặt (mặc định Win + F12) -> tab "Model" -> bấm "Import model (.zip)" rồi chọn file zip của model
(hoặc kéo thả file .zip vào tab Model). App tự tìm đúng thư mục chứa model.json trong zip, bỏ các file thừa, kiểm tra hợp lệ
rồi đưa vào thư mục này. Model tạo bằng app Ezy Maker (nút "Xuất zip") dùng được ngay.

CÁCH THỦ CÔNG:
Mỗi model là MỘT THƯ MỤC CON trong thư mục "model" này (cạnh file EzyTuber.exe).
Thêm/xoá model chỉ cần tạo/xoá thư mục, KHÔNG cần build lại app.
Sau khi thêm: mở Cài đặt (mặc định Win + F12) -> tab "Model" -> bấm "Quét lại".
Thư mục bắt đầu bằng "_" hoặc "." sẽ bị bỏ qua (dùng để cất model tạm).

  EzyTuber.exe
  config.json                 <- cài đặt chung (app tự tạo)
  model/
    <tên model>/              <- tên thư mục = mã định danh của model
      model.json              <- BẮT BUỘC: khung xương + danh sách thanh kéo (mô tả bên dưới)
      settings.json           <- tự tạo: tên hiển thị, phím chuyển, cỡ, giá trị thanh kéo của model này
      assets/
        layer/                <- ảnh các layer (png/webp)
        emo/                  <- ảnh emote, miệng mở... (để riêng cho gọn; để chung trong layer/ cũng được)

Đường dẫn ảnh trong model.json ("src") là đường dẫn TƯƠNG ĐỐI so với thư mục model,
ví dụ "assets/layer/face.webp". Thư mục con đặt tên gì cũng được.

---------------------------------------------------------------------
 model.json
---------------------------------------------------------------------
{
 "format": 1,
 "name": "Tên hiển thị mặc định",
 "crop":    { "x": 0, "y": 0, "w": 400, "h": 1000 },
 "nodes":   [ ... ],
 "sprites": [ ... ],
 "tune":    [ ... ]
}

crop   : khung hiển thị, tính bằng pixel của canvas gốc (cùng hệ toạ độ với x,y của sprite).
         Nên chừa lề ~28px phía trên và ~20px hai bên để model nảy/lắc không bị cắt mép cửa sổ.

nodes  : các "khớp". Con đi theo cha. Cha phải đứng TRƯỚC con trong danh sách.
  { "id": "head", "parent": "neck", "pivot": [518,190], ... }
   id      tên khớp (chữ, số, _ , -)
   parent  khớp cha, hoặc null / bỏ qua nếu là gốc
   pivot   điểm xoay [x,y] (toạ độ canvas gốc)
   rest    {"rot": độ}  góc xoay mặc định (nắn thẳng đầu nếu ảnh gốc bị nghiêng)
   look    chuyển động theo chuột: {"x": px, "y": px, "rot": độ} (giá trị khi chuột lệch hết cỡ)
   voice   chuyển động theo âm lượng mic: {"y": px, "sy": giãn dọc}
   breath  nhịp thở khi đứng yên: {"y": px, "sy": giãn dọc}
   spring  lò xo xoay (đung đưa có quán tính):
           {"src":"head.rot" | "lx" | "ly" | "lvl", "amp":hệ số, "gain":độ mạnh, "k":độ cứng, "c":giảm chấn}
   springY như spring nhưng dịch theo trục dọc (src dạng "khớp.ty")

sprites: các layer ảnh. THỨ TỰ = thứ tự chồng lớp (đầu tiên nằm dưới cùng).
  { "id":"face", "src":"assets/layer/face.webp", "node":"head", "x":445, "y":48, "w":122, "h":138 }
   x,y,w,h  vị trí + kích thước ảnh trong canvas gốc
   node     khớp gắn vào; null = đứng yên
   show     "talk" (chỉ hiện khi đang nói) | "!talk" (chỉ hiện khi KHÔNG nói) | "emote" (hiện khi bật emote)
   blink    chớp mắt: {"sq":1} bóp dẹt mắt;  {"dy":9} hạ mi xuống 9px
   vs       co giãn theo âm lượng (miệng mở): {"x":[0.8,0.3],"y":[0.35,0.65],"ox":0.5,"oy":0}

tune   : các thanh kéo hiện trong tab "Tinh chỉnh" (tuỳ chọn).
  { "k":"head_rest", "label":"Độ nghiêng đầu (°)", "group":"Đầu & cổ", "min":-20, "max":20, "step":0.1, "set":["head.rest.rot"] }
   set    danh sách đường dẫn "khớp.nhóm.thuộc_tính" mà thanh này điều khiển
   sign   -1 nếu muốn hiển thị đảo dấu
  Thanh "nhân chung": thay "set" bằng "g" (look/voice/breath/spring/range/follow/vfollow) và "def" (giá trị mặc định).

---------------------------------------------------------------------
 BIỂU CẢM & EMOTE (model format 2) — tuỳ chọn
---------------------------------------------------------------------
Model có thể khai báo nhiều biểu cảm khuôn mặt (mắt, miệng...) và nhiều emote. Người dùng gán phím tắt cho từng cái trong
Cài đặt (Win + F12) -> tab "Biểu cảm" (mỗi model có bộ phím riêng, chỉ hoạt động khi model đó đang dùng).

  "expressions": { "eyes": { "name":"Mắt", "default":"normal", "states":[ {"id":"normal","name":"Bình thường"}, {"id":"happy","name":"Vui"} ] },
                   "mouth": { "name":"Miệng", "default":"normal", "states":[ ... ] } }
  "emotes": [ {"id":"heart","name":"Trái tim","duration":3,"group":"mood"}, {"id":"sweat","name":"Mồ hôi"} ]
  sprite:   "when": { "eyes":["happy"], "mouth":["smile","laugh"], "emote":["heart"] }

  - Mỗi nhóm biểu cảm có đúng một trạng thái đang chọn; bấm phím của trạng thái đang bật = quay về mặc định.
  - Sprite có "when" chỉ hiện khi MỌI điều kiện thoả (AND); trong một mảng chỉ cần khớp một giá trị (OR). Không có "when" = luôn hiện.
  - Emote bật/tắt độc lập. duration = tự tắt sau N giây (0 hoặc bỏ qua = bật tới khi tắt). Các emote cùng group loại trừ nhau.
  - Miệng nói: sprite miệng đóng đặt "show":"!talk", miệng mở đặt "show":"talk" + "vs", kèm "when" của trạng thái miệng đó.
  - Mẫu: xem model "Moe Demo Bieu Cam" (có sẵn 3 trạng thái mắt, 3 trạng thái miệng, 3 emote).
  - Model cũ (format 1) vẫn dùng bình thường.

Model có file lỗi vẫn hiện trong tab "Model" kèm lý do, nhưng không dùng được cho tới khi sửa xong.
Mẫu đầy đủ: xem model/Moe Shinn/model.json.
