EZY TUBER  (trước đây là PNGTuber Maker)
=========================================
App hiển thị PNGTuber dựng từ các layer, theo dõi chuột và giọng nói. Không có công cụ tạo/rig model
(sẽ làm thành app riêng) — Ezy Tuber chỉ nạp model có sẵn trong thư mục "model".

Cấu trúc (bản portable): file EzyTuber.exe + thư mục model/ nằm cạnh nhau; config.json tự sinh ra cạnh exe.

CHẠY THỬ : bấm đúp start.bat   (cần Node.js LTS, lần đầu tự npm install)
ĐÓNG GÓI : bấm đúp build-exe.bat -> thư mục dist\ có EzyTuber.exe và model\
THÊM MODEL: Cài đặt -> Model -> "Import model (.zip)" (tự lọc đúng thư mục trong zip), hoặc xem model\README.txt để làm thủ công.
             Nếu chưa có thư mục model cạnh exe thì app tự tạo khi khởi động, kèm file README.txt hướng dẫn.
TẠO MODEL : dùng app Ezy Maker (kéo-thả layer, tự rig, xem thử, xuất zip). Xuất ra thư mục <tên model>, giải nén vào model\ rồi Cài đặt -> Model -> Quét lại.

SỬ DỤNG
- Cửa sổ model không có thanh/nền. Kéo thả thân nhân vật để di chuyển; vị trí được nhớ cho lần sau.
- Win + F12 mở/đóng cửa sổ Cài đặt (đổi được ở tab Cơ bản; luôn có phím dự phòng Ctrl + Alt + F12).
- Tab Model: danh sách model, bấm "Dùng" để đổi, sửa tên, và bấm vào ô phím rồi nhấn tổ hợp phím để gán
  phím chuyển nhanh sang model đó (hoạt động cả khi đang chơi game).
- Tab Biểu cảm: đổi biểu cảm mắt/miệng và bật/tắt emote; bấm vào ô phím rồi nhấn tổ hợp phím để gán phím tắt cho từng cái
  (bấm lại phím của biểu cảm đang bật = về mặc định; emote có thể tự tắt sau vài giây). Mỗi model có bộ phím riêng.
- Tab Tinh chỉnh: thanh kéo chuyển động, lưu riêng cho từng model.
- Cỡ model lưu riêng cho từng model. Nút "Thoát ứng dụng" nằm trong cửa sổ Cài đặt.
- OBS: dùng Window Capture (Windows 10 1903+), chọn cửa sổ "Ezy Tuber". Model vẫn chạy khi bị che.
  Nền "Trong suốt" lên alpha; nếu không, chọn nền xanh lá trong Cài đặt rồi dùng Chroma Key.
- Nếu chương trình thấy CPU cao: Cài đặt -> Nhịp thở = Tiết kiệm/Tắt, hoặc FPS thấp hơn.
