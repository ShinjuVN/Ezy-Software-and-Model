EZY MAKER — công cụ thiết kế / rig model cho Ezy Tuber
======================================================
CHẠY THỬ : bấm đúp start.bat (cần Node.js LTS, lần đầu tự npm install)
ĐÓNG GÓI : bấm đúp build-exe.bat -> dist\EzyMaker.exe (prompt.txt để cạnh exe, sửa được)

QUY TRÌNH NHANH
 1. Nhập layer: kéo thả file .png / .zip / cả thư mục vào cửa sổ (hoặc bấm 📥 Nhập layer).
    Layer nên cùng kích thước canvas (không cắt gọn) — Ezy Maker tự cắt gọn và nhớ vị trí. Có layers.json đi kèm thì dùng luôn.
 2. 🧩 Tạo khung xương tự động: nhận diện layer theo tên, tạo khớp, pivot, chuyển động mặc định, nắn thẳng đầu, ẩn layer bị che.
 3. ▶ Xem thử: model chạy bằng đúng engine của Ezy Tuber; di chuột để model nhìn theo.
 4. Chỉnh bằng kéo-thả:
      - Canvas: bấm chọn layer (theo pixel), Ctrl/Shift hoặc kéo khung để chọn nhiều, kéo để di chuyển, phím mũi tên để nhích 1px (Shift = 10px),
        Alt+bấm = chọn layer bên dưới, kéo chấm vàng = đặt pivot (điểm xoay).
      - Danh sách layer: kéo-thả đổi thứ tự chồng lớp, 👁 ẩn/hiện (layer ẩn không xuất), lọc theo tên.
      - Tab Khớp: cây khớp (kéo khớp thả lên khớp khác để đổi cha), thông số chuyển động từng khớp.
      - Ctrl+Z / Ctrl+Y hoàn tác / làm lại.
 5. 📦 Xuất zip: ra <tên model>.zip chứa thư mục <tên model>/ (model.json, settings.json, assets/). Giải nén vào thư mục model/ của Ezy Tuber.
 6. 📂 Nhập model để chỉnh sửa: mở lại zip / thư mục model đã làm (từ Maker, AI hoặc từ model/ của Ezy Tuber) để sửa tiếp.
    Layer, khớp, chuyển động, thanh kéo và settings.json (phím chuyển, cỡ) được giữ nguyên.
 7. 📖 Hướng dẫn dùng AI để rig model: các bước tách layer bằng See-through (Hugging Face) và prompt đầy đủ để AI tự rig.

LƯU Ý
 - Ezy Maker không sửa/vẽ lại ảnh; chỉ cắt gọn theo vùng có pixel. Muốn đổi ảnh thì sửa bằng phần mềm vẽ rồi nhập lại.
 - Danh sách thanh kéo trong Ezy Tuber tự sinh từ các khớp (tắt được ở tab Model).
