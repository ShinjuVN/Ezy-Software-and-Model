EZY MAKER — công cụ thiết kế / rig model cho Ezy Tuber
======================================================
CHẠY THỬ : bấm đúp start.bat (cần Node.js LTS, lần đầu tự npm install)
ĐÓNG GÓI : bấm đúp build-exe.bat -> dist\EzyMaker.exe

QUY TRÌNH NHANH
 1. Nhập layer: kéo thả file .png / .zip / cả thư mục vào cửa sổ (hoặc bấm 📥 Nhập layer).
    Layer nên cùng kích thước canvas (không cắt gọn) — Ezy Maker tự cắt gọn và nhớ vị trí. Có layers.json đi kèm thì dùng luôn.
 2. 🧩 Tạo khung xương tự động: nhận diện layer theo tên, tạo khớp, pivot, chuyển động mặc định, nắn thẳng đầu, ẩn layer bị che.
 3. ▶ Xem thử: model chạy bằng đúng engine của Ezy Tuber; di chuột để model nhìn theo. Có thể đổi nền (màu / ca rô) hoặc chọn ảnh từ máy làm nền (cũng kéo thả ảnh vào khung được).
 3b. Biểu cảm & emote: tab "Biểu cảm" (bên phải) tạo nhóm Mắt/Miệng, các trạng thái (bình thường, vui, nhắm...) và emote. Layer có tên dạng
    irides_happy-l, mouth_smile, mouth_smile_open, emote_heart... được tự nhận diện khi bấm "Tạo khung xương tự động". Chọn layer rồi bấm ⬇ ở trạng thái/emote
    để gán; tick trong mục "Hiển thị theo biểu cảm / emote" của tab Layer; bật "Chỉ hiện layer đúng trạng thái" để thiết kế từng trạng thái.
    Phím tắt được gán trong Ezy Tuber (Cài đặt -> tab Biểu cảm).
 4. Chỉnh bằng kéo-thả:
      - Canvas: bấm chọn layer (theo pixel), Ctrl/Shift hoặc kéo khung để chọn nhiều, kéo để di chuyển, phím mũi tên để nhích 1px (Shift = 10px),
        Alt+bấm = chọn layer bên dưới, kéo chấm vàng = đặt pivot (điểm xoay).
      - Danh sách layer: kéo-thả đổi thứ tự chồng lớp, 👁 ẩn/hiện (layer ẩn không xuất), lọc theo tên.
      - Tab Khớp: cây khớp (kéo khớp thả lên khớp khác để đổi cha), thông số chuyển động từng khớp.
      - Ctrl+Z / Ctrl+Y hoàn tác / làm lại.
 5. 📦 Xuất zip: ra <tên model>.zip chứa thư mục <tên model>/ (model.json, settings.json, assets/). Giải nén vào thư mục model/ của Ezy Tuber.
 6. 📂 Nhập model để chỉnh sửa: mở lại zip / thư mục model đã làm (từ Maker hoặc từ model/ của Ezy Tuber) để sửa tiếp.
    Layer, khớp, chuyển động, thanh kéo và settings.json (phím chuyển, cỡ) được giữ nguyên.

FILE KÈM
 - prompt.txt: prompt để dán cho AI (kèm file zip layer) nhờ rig model bản mới hỗ trợ nhiều biểu cảm + emote; AI trả về zip <tên model>/ dùng được ngay.

LƯU Ý
 - Ezy Maker không sửa/vẽ lại ảnh; chỉ cắt gọn theo vùng có pixel. Muốn đổi ảnh thì sửa bằng phần mềm vẽ rồi nhập lại.
 - Danh sách thanh kéo trong Ezy Tuber tự sinh từ các khớp (tắt được ở tab Model).
