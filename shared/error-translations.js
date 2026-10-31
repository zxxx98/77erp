import { processRouteMessages } from './process-route-messages.js';
import { createValidationTranslator } from './error-translation-runtime.js';
// System validation text only; never include stored business values in this catalog.
export const validationMessages = {
  VALIDATION_USER_POSITIONS_REQUIRED: ['请为员工选择至少一个有效且不重复的岗位。', 'Select at least one valid position without duplicates.', 'Chọn ít nhất một vị trí hợp lệ và không trùng lặp.'],
  VALIDATION_USER_POSITIONS_CONFLICT: ['岗位参数不一致，请刷新后重新选择。', 'Position parameters conflict. Refresh and select again.', 'Tham số vị trí không nhất quán. Làm mới và chọn lại.'],
  VALIDATION_USER_EMPLOYEE_NO_INVALID: ['工号需为 1–60 个字符。', 'Employee number needs to be 1–60 characters long.', 'Mã nhân viên cần dài 1–60 ký tự.'],
  "VALIDATION_PRODUCTION_ASSIGNMENT_INVALID_ASSIGNED_GROUPS": ["请选择有效且不重复的生产组。", "Select valid groups without duplicates.", "Chọn các tổ hợp lệ và không trùng lặp."],
  "VALIDATION_PRODUCTION_ASSIGNMENT_INVALID_ASSIGNED_USERS": ["请选择有效且不重复的生产人员。", "Select valid people without duplicates.", "Chọn nhân viên hợp lệ và không trùng lặp."],
  "VALIDATION_PRODUCTION_ASSIGNMENT_UNAVAILABLE_ASSIGNEE": ["生产人员不存在、已停用或没有生产权限。", "The person is unavailable or lacks production permission.", "Nhân viên không tồn tại, đã ngừng hoạt động hoặc thiếu quyền sản xuất."],
  "VALIDATION_PRODUCTION_ASSIGNMENT_EXPLICIT_ASSIGNMENT_REQUIRED": ["请选择生产组或生产人员，或明确取消派工。", "Select groups or people, or explicitly clear assignments.", "Chọn tổ hoặc nhân viên, hoặc xóa phân công một cách rõ ràng."],
  "VALIDATION_PRODUCTION_ASSIGNMENT_ASSIGN_OPEN_ORDERS_ONLY": ["仅未结束的生产单可以派工。", "Only open orders can be assigned.", "Chỉ có thể phân công lệnh chưa kết thúc."],
  "VALIDATION_PRODUCTION_ASSIGNMENT_APPEND_ONLY_ASSIGNMENTS": ["已开始的生产单仅支持追加指派，不能移除原有生产组或人员。", "Started orders only allow adding assignments. Existing groups and people must be retained.", "Lệnh đã bắt đầu chỉ cho phép thêm phân công. Phải giữ nguyên tổ và nhân viên hiện có."],
  "VALIDATION_PRODUCTION_ASSIGNMENT_NOT_ASSIGNED": ["生产单不存在或未指派给当前用户。", "Order not found or not assigned to you.", "Không tìm thấy lệnh hoặc lệnh chưa được giao cho bạn."],
  "VALIDATION_PRODUCTION_ASSIGNMENT_INVALID_OPERATION_ASSIGNEE": ["仅可选择本人或本单已指派的有效员工。", "Select yourself or an active employee assigned to this order.", "Chọn chính bạn hoặc nhân viên đang hoạt động được giao lệnh này."],
  "VALIDATION_PRODUCTION_ASSIGNMENT_BACKUP": ["备份生产指派无效。", "Invalid production assignments in backup.", "Phân công sản xuất trong bản sao lưu không hợp lệ."],
  ...processRouteMessages,
  "VALIDATION_OVER_ISSUE_MATERIAL": ["本次发料的材料需属于当前申请。", "Materials issued must belong to the current request.", "Nguyên liệu cấp phải thuộc yêu cầu hiện tại."],
  "VALIDATION_PARTIAL_ISSUE_STOCK": ["{p0}库存不足，请核对本次实发数量。", "Insufficient stock for {p0}. Check this issue quantity.", "Không đủ tồn kho cho {p0}. Kiểm tra số lượng cấp lần này."],
  "VALIDATION_PARTIAL_ISSUE_LINES": ["请核对材料明细，材料不能重复。", "Check material lines; duplicate materials are not allowed.", "Kiểm tra chi tiết; không được trùng nguyên liệu."],
  "VALIDATION_PARTIAL_ISSUE_LIMIT": ["材料数量超出范围。", "Material quantity is out of range.", "Số lượng nguyên liệu vượt giới hạn."],
  "VALIDATION_PARTIAL_RETURN_WHOLE": ["退料单需整单确认。", "A material return must be confirmed in full.", "Phiếu trả nguyên liệu phải được xác nhận toàn bộ."],
  "VALIDATION_AI_IMAGES_135A43E060": [
    "每次最多添加 {p0} 张图片。",
    "A maximum of {p0} images can be added at a time.",
    "Có thể thêm tối đa hình ảnh {p0} cùng một lúc."
  ],
  "VALIDATION_AI_IMAGES_627DBB831D": [
    "图片名称无效。",
    "The image name is invalid.",
    "Tên hình ảnh không hợp lệ."
  ],
  "VALIDATION_AI_IMAGES_0ADB7D9B9C": [
    "压缩后的图片不能超过 1 MB。",
    "Compressed images cannot exceed 1 MB.",
    "Hình ảnh nén không thể vượt quá 1 MB."
  ],
  "VALIDATION_AI_IMAGES_AB3F74071E": [
    "请选择 JPG、PNG 或 WebP 图片。",
    "Please select a JPG, PNG or WebP image.",
    "Vui lòng chọn hình ảnh JPG, PNG hoặc WebP."
  ],
  "VALIDATION_AI_IMAGES_F610526521": [
    "图片数据无效或超过 1 MB。",
    "Image data is invalid or exceeds 1 MB.",
    "Dữ liệu hình ảnh không hợp lệ hoặc vượt quá 1 MB."
  ],
  "VALIDATION_AI_IMAGES_AECFD01D07": [
    "图片内容与格式不符，或不是静态图片。",
    "The image content does not match the format, or it is not a static image.",
    "Nội dung hình ảnh không đúng định dạng hoặc không phải là hình ảnh tĩnh."
  ],
  "VALIDATION_AI_IMAGES_F832C01AF4": [
    "图片内容过大，请裁剪后重新添加。",
    "The image content is too large, please crop it and add it again.",
    "Nội dung hình ảnh quá lớn, vui lòng cắt và thêm lại."
  ],
  "VALIDATION_AI_IMAGES_8271D27346": [
    "图片无法读取，请选择有效的 JPG、PNG 或 WebP 图片。",
    "Image cannot be read, please select a valid JPG, PNG or WebP image.",
    "Không thể đọc được hình ảnh, vui lòng chọn hình ảnh JPG, PNG hoặc WebP hợp lệ."
  ],
  "VALIDATION_AI_QUALITY_CHARTS_141A7D90F7": [
    "模板查询条件最多100字。",
    "Template query conditions can be up to 100 words.",
    "Điều kiện truy vấn mẫu có thể lên tới 100 từ."
  ],
  "VALIDATION_AI_QUALITY_CHARTS_B3D592C8A3": [
    "请选择有效的模板发布版本。",
    "Please select a valid template release version.",
    "Vui lòng chọn phiên bản phát hành mẫu hợp lệ."
  ],
  "VALIDATION_AI_QUALITY_CHARTS_4EB30174D8": [
    "预览物料编号无效。",
    "The preview item number is invalid.",
    "Số mục xem trước không hợp lệ."
  ],
  "VALIDATION_AI_QUALITY_CHARTS_2F40AE9D9F": [
    "预览物料不存在或不属于当前仓库。",
    "The preview material does not exist or does not belong to the current warehouse.",
    "vật tư xem trước không tồn tại hoặc không thuộc về kho hiện tại."
  ],
  "VALIDATION_AI_QUALITY_CHARTS_6480D6A5DD": [
    "物料图表按当前物料取数，未指定预览物料；保存后可在物料详情查看。",
    "The material chart is based on the current material, and no preview material is specified; it can be viewed in the material details after saving.",
    "Biểu đồ vật liệu dựa trên vật tư hiện tại và không có vật tư xem trước nào được chỉ định; nó có thể được xem trong chi tiết vật liệu sau khi lưu."
  ],
  "VALIDATION_AI_QUALITY_CHARTS_65D4E83CEF": [
    "当前没有可用于此配置的已保存数据。",
    "There is currently no saved data available for this configuration.",
    "Hiện tại không có dữ liệu đã lưu cho cấu hình này."
  ],
  "VALIDATION_AI_QUALITY_CHARTS_7B960A6E75": [
    "请切回生成图表预览时的仓库后确认。",
    "Please switch back to the warehouse where you generated the chart preview and confirm.",
    "Vui lòng chuyển về kho nơi bạn đã tạo bản xem trước biểu đồ và xác nhận."
  ],
  "VALIDATION_AI_B04491591D": [
    "服务端需配置 AI_ENCRYPTION_KEY（32字节随机密钥的64位十六进制）。",
    "The server needs to configure AI_ENCRYPTION_KEY (64-digit hexadecimal number of 32-byte random key).",
    "Máy chủ cần định cấu hình AI_ENCRYPTION_KEY (số thập lục phân 64 chữ số của khóa ngẫu nhiên 32 byte)."
  ],
  "VALIDATION_AI_6D3E9013E1": [
    "登录已失效，请重新登录。",
    "Login has expired, please log in again.",
    "Đăng nhập đã hết hạn, vui lòng đăng nhập lại."
  ],
  "VALIDATION_AI_0699B8DB4A": [
    "没有 AI 助手使用权限。",
    "No access to AI Assistant.",
    "Không có quyền truy cập vào Trợ lý AI."
  ],
  "VALIDATION_AI_FC35271B31": [
    "AI 助手未启用。",
    "AI Assistant is not enabled.",
    "Trợ lý AI chưa được bật."
  ],
  "VALIDATION_AI_707AA719C9": [
    "没有此业务操作的权限。",
    "There is no permission for this business operation.",
    "Không có sự cho phép cho hoạt động kinh doanh này."
  ],
  "VALIDATION_AI_F71F3A4F33": [
    "请选择有效仓库。",
    "Please select a valid warehouse.",
    "Vui lòng chọn một kho hợp lệ."
  ],
  "VALIDATION_AI_67DB919E88": [
    "仓库不存在。",
    "The warehouse does not exist.",
    "Nhà kho không tồn tại."
  ],
  "VALIDATION_AI_5564108E30": [
    "对话编号无效。",
    "The conversation number is invalid.",
    "Số cuộc trò chuyện không hợp lệ."
  ],
  "VALIDATION_AI_E2FA6B2E17": [
    "对话不存在或无权访问。",
    "The conversation does not exist or you do not have access to it.",
    "Cuộc trò chuyện không tồn tại hoặc bạn không có quyền truy cập vào cuộc trò chuyện đó."
  ],
  "VALIDATION_AI_066030267D": [
    "权限已变化，请开始新对话。",
    "Permissions have changed, please start a new conversation.",
    "Quyền đã thay đổi, vui lòng bắt đầu một cuộc trò chuyện mới."
  ],
  "VALIDATION_AI_FF1FCF5294": [
    "管理员已关闭 AI 写操作。",
    "The administrator has turned off AI write operations.",
    "Quản trị viên đã tắt thao tác ghi AI."
  ],
  "VALIDATION_AI_85FF407E30": [
    "出入库方向无效。",
    "The inbound and outbound direction is invalid.",
    "Hướng vào và ra không hợp lệ."
  ],
  "VALIDATION_AI_9C0BA4B0A2": [
    "工具参数无效。",
    "Tool parameter is invalid.",
    "Tham số công cụ không hợp lệ."
  ],
  "VALIDATION_AI_D5982A6A86": [
    "请输入最多100字的往来单位名称。",
    "Please enter the name of the company you are dealing with, up to 100 characters in length.",
    "Vui lòng nhập tên công ty bạn đang giao dịch, độ dài tối đa 100 ký tự."
  ],
  "VALIDATION_AI_E1036B260E": [
    "物料查询条件无效。",
    "The material query condition is invalid.",
    "Điều kiện truy vấn vật tư không hợp lệ."
  ],
  "VALIDATION_AI_A3E360421C": [
    "请选择两个不同仓库。",
    "Please select two different warehouses.",
    "Vui lòng chọn hai kho khác nhau."
  ],
  "VALIDATION_AI_7BC3359255": [
    "源仓库中未找到物料。",
    "The item was not found in the source warehouse.",
    "Mặt hàng không được tìm thấy trong kho nguồn."
  ],
  "VALIDATION_AI_2DD7A398D5": [
    "目标仓库有多个关联物料，请先核对档案。",
    "The target warehouse has multiple related materials, please check the files first.",
    "Kho mục tiêu có nhiều vật tư liên quan, vui lòng kiểm tra hồ sơ trước."
  ],
  "VALIDATION_AI_8F9397AF03": [
    "目标仓库未建档，不能当作零库存。",
    "The target warehouse has not been archived and cannot be regarded as zero inventory.",
    "Kho mục tiêu chưa được lưu trữ và không thể được coi là không có hàng tồn kho."
  ],
  "VALIDATION_AI_5FB460FEF0": [
    "单位不同，不能直接计算差值。",
    "The units are different and the difference cannot be calculated directly.",
    "Các đơn vị là khác nhau và sự khác biệt không thể được tính trực tiếp."
  ],
  "VALIDATION_AI_63C6E804E3": [
    "校验筛选参数无效。",
    "Validation filter parameters are invalid.",
    "Các tham số bộ lọc xác thực không hợp lệ."
  ],
  "VALIDATION_AI_DC0F7AA9FD": [
    "每批最多20张单据，合计100行物料。",
    "Each batch can contain up to 20 documents, totaling 100 lines of materials.",
    "Mỗi đợt có thể chứa tối đa 20 vật tư, tổng cộng 100 dòng vật tư."
  ],
  "VALIDATION_AI_DE584ED1B7": [
    "物料不存在。",
    "The material does not exist.",
    "Vật chất không tồn tại."
  ],
  "VALIDATION_AI_D15905E1ED": [
    "数量需为正数且最多4位小数。",
    "The quantity must be a positive number with up to 4 decimal places.",
    "Số lượng phải là số dương có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_AI_77B71A2232": [
    "调入仓库不能与调出仓库相同。",
    "The transfer into the warehouse cannot be the same as the transfer out of the warehouse.",
    "Việc chuyển vào kho không thể giống việc chuyển ra khỏi kho."
  ],
  "VALIDATION_AI_301DDEDBA1": [
    "请提供1–500字的操作原因。",
    "Please provide a reason for your action in 1–500 words.",
    "Vui lòng cung cấp lý do cho hành động của bạn trong vòng 1–500 từ."
  ],
  "VALIDATION_AI_1BC64DEC09": [
    "每次操作请选择1–{p0}种物料。",
    "Please select 1-{p0} materials for each operation.",
    "Vui lòng chọn vật liệu 1-{p0} cho mỗi thao tác."
  ],
  "VALIDATION_AI_DCB8C024B1": [
    "物料编号无效或重复。",
    "The material number is invalid or duplicate.",
    "Số vật tư không hợp lệ hoặc trùng lặp."
  ],
  "VALIDATION_AI_AA0C471E99": [
    "物料不属于指定仓库。",
    "The material does not belong to the specified warehouse.",
    "Vật liệu không thuộc về kho được chỉ định."
  ],
  "VALIDATION_AI_67A655D808": [
    "实盘数量必须为非负数且最多4位小数。",
    "The actual quantity must be non-negative and have up to 4 decimal places.",
    "Số lượng thực tế phải không âm và có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_AI_1128768B20": [
    "调拨数量必须为正数且最多4位小数。",
    "The transfer quantity must be a positive number with up to 4 decimal places.",
    "Số lượng chuyển phải là số dương có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_AI_865460393D": [
    "目标仓库物料关联冲突，请先核对档案。",
    "There is a conflict in the target warehouse material association, please check the file first.",
    "Có xung đột trong liên kết vật liệu kho mục tiêu, vui lòng kiểm tra tệp trước."
  ],
  "VALIDATION_AI_1C98AC35F6": [
    "调出和调入物料单位不同，请先核对档案。",
    "The units of materials transferred out and transferred in are different, please check the file first.",
    "Đơn vị vật tư chuyển ra và chuyển vào khác nhau, vui lòng kiểm tra hồ sơ trước."
  ],
  "VALIDATION_AI_CFFDB4A28E": [
    "多个调出物料对应同一调入物料，请先核对档案。",
    "Multiple transferred-out materials correspond to the same transferred-in material, please check the file first.",
    "Nhiều vật tư được chuyển đi tương ứng với cùng một vật tư được chuyển vào, vui lòng kiểm tra tệp trước."
  ],
  "VALIDATION_AI_D7CA0778DD": [
    "每次请选择1–100种物料。",
    "Please select 1–100 materials each time.",
    "Vui lòng chọn 1–100 vật tư mỗi lần."
  ],
  "VALIDATION_AI_B1D077E2FE": [
    "{p0} 已停用，无需校验。",
    "{p0} is deactivated and does not require verification.",
    "{p0} đã bị vô hiệu hóa và không yêu cầu xác minh."
  ],
  "VALIDATION_AI_5211BA10F3": [
    "{p0} 尚未到校验日期。",
    "{p0} has not yet reached the verification date.",
    "{p0} vẫn chưa đến ngày xác minh."
  ],
  "VALIDATION_AI_45134415E9": [
    "当前对话没有上传表格，请先上传 Excel 或 CSV 文件。",
    "There is no table uploaded in the current conversation. Please upload an Excel or CSV file first.",
    "Không có bảng nào được tải lên trong cuộc trò chuyện hiện tại. Trước tiên hãy tải lên tệp Excel hoặc CSV."
  ],
  "VALIDATION_AI_0126CA46A6": [
    "表格需为表头加1–1000行、最多40列，每个单元格最多1000字。",
    "The table needs to add 1-1000 rows to the header, a maximum of 40 columns, and a maximum of 1000 words per cell.",
    "Bảng cần thêm 1-1000 hàng vào tiêu đề, tối đa 40 cột và tối đa 1000 từ cho mỗi ô."
  ],
  "VALIDATION_AI_4DFDA36EE3": [
    "请先上传 Excel 或 CSV 文件。",
    "Please upload an Excel or CSV file first.",
    "Trước tiên hãy tải lên tệp Excel hoặc CSV."
  ],
  "VALIDATION_AI_9768B44639": [
    "列映射无效；必须指定物料名称和单位。",
    "Invalid column mapping; material name and unit must be specified.",
    "Ánh xạ cột không hợp lệ; tên vật liệu và đơn vị phải được chỉ định."
  ],
  "VALIDATION_AI_62E97AF46A": [
    "默认分类不存在或不属于当前仓库。",
    "The default category does not exist or does not belong to the current warehouse.",
    "Danh mục mặc định không tồn tại hoặc không thuộc về kho hiện tại."
  ],
  "VALIDATION_AI_C9A505EB5E": [
    "第 {p0} 行的分类名称超过100字，请使用已有分类或缩短名称。",
    "The category name in line {p0} exceeds 100 characters. Please use an existing category or shorten the name.",
    "Tên danh mục trong dòng {p0} vượt quá 100 ký tự. Vui lòng sử dụng danh mục hiện có hoặc rút ngắn tên."
  ],
  "VALIDATION_AI_7D6D701FBB": [
    "第 {p0} 行的固定资产标记无法识别，请使用是/否、true/false 或 1/0。",
    "Unrecognized fixed asset tag for row {p0}, please use yes/no, true/false or 1/0.",
    "Thẻ tài sản cố định không được nhận dạng cho hàng {p0}, vui lòng sử dụng có/không, đúng/sai hoặc 1/0."
  ],
  "VALIDATION_AI_CB4CAA1624": [
    "第 {p0} 行的单位是否取整标记无法识别，请使用是/否、true/false 或 1/0。",
    "Unrecognized unit rounding flag at row {p0}, please use yes/no, true/false or 1/0.",
    "Cờ làm tròn đơn vị không được nhận dạng ở hàng {p0}, vui lòng sử dụng có/không, đúng/sai hoặc 1/0."
  ],
  "VALIDATION_AI_7D7E71DCB5": [
    "第 {p0} 行的{p1}标记无法识别，请使用是/否、true/false 或 1/0。",
    "The {p1} tag at line {p0} is not recognized, please use yes/no, true/false or 1/0.",
    "Thẻ {p1} ở dòng {p0} không được nhận dạng, vui lòng sử dụng có/không, đúng/sai hoặc 1/0."
  ],
  "VALIDATION_AI_02AC5DE83B": [
    "第 {p0} 行的 {p1} 不是有效非负数字。",
    "{p1} at line {p0} is not a valid non-negative number.",
    "{p1} tại dòng {p0} không phải là số không âm hợp lệ."
  ],
  "VALIDATION_AI_1C21AEA62D": [
    "不支持此工具。",
    "This tool is not supported.",
    "Công cụ này không được hỗ trợ."
  ],
  "VALIDATION_AI_997FA38A8B": [
    "AI 配置格式无效。",
    "The AI configuration format is invalid.",
    "Định dạng cấu hình AI không hợp lệ."
  ],
  "VALIDATION_AI_5C3B04AA82": [
    "请填写有效的 HTTPS API 基础地址。",
    "Please fill in a valid HTTPS API base address.",
    "Vui lòng điền địa chỉ cơ sở API HTTPS hợp lệ."
  ],
  "VALIDATION_AI_FA9A681D53": [
    "API 基础地址需为不含凭据、查询参数的 HTTPS 地址。",
    "The API base address must be an HTTPS address without credentials and query parameters.",
    "Địa chỉ cơ sở API phải là địa chỉ HTTPS không có thông tin xác thực và tham số truy vấn."
  ],
  "VALIDATION_AI_6F62B2D57F": [
    "API Key 格式无效。",
    "API Key format is invalid.",
    "Định dạng khóa API không hợp lệ."
  ],
  "VALIDATION_AI_0B768FA4D1": [
    "清除密钥参数无效。",
    "The clear key parameter is invalid.",
    "Tham số khóa rõ ràng không hợp lệ."
  ],
  "VALIDATION_AI_611B26AC0A": [
    "更换服务地址时必须重新填写 API Key。",
    "The API Key must be filled in again when changing the service address.",
    "Khóa API phải được điền lại khi thay đổi địa chỉ dịch vụ."
  ],
  "VALIDATION_AI_DC81700434": [
    "启用前请配置模型和 API Key。",
    "Please configure the model and API Key before enabling it.",
    "Vui lòng định cấu hình mô hình và Khóa API trước khi bật nó."
  ],
  "VALIDATION_AI_DF248894E2": [
    "AI 服务连接失败或超时，请稍后重试。",
    "The AI service connection failed or timed out, please try again later.",
    "Kết nối dịch vụ AI không thành công hoặc hết thời gian chờ, vui lòng thử lại sau."
  ],
  "VALIDATION_AI_BABE3097CE": [
    "AI 响应超过256KB限制。",
    "AI response exceeds 256KB limit.",
    "Phản hồi AI vượt quá giới hạn 256KB."
  ],
  "VALIDATION_AI_E489BD7348": [
    "AI 响应读取失败或超时，请检查服务商连接。",
    "AI response reading failed or timed out, please check the service provider connection.",
    "Việc đọc phản hồi AI không thành công hoặc hết thời gian chờ, vui lòng kiểm tra kết nối của nhà cung cấp dịch vụ."
  ],
  "VALIDATION_AI_753977C0A9": [
    "AI 服务返回的不是有效JSON（HTTP {p0}），请检查API地址是否指向兼容Chat Completions的接口。",
    "The AI service returns not valid JSON (HTTP {p0}). Please check whether the API address points to an interface compatible with Chat Completions.",
    "Dịch vụ AI trả về JSON không hợp lệ (HTTP {p0}). Vui lòng kiểm tra xem địa chỉ API có trỏ đến giao diện tương thích với Hoàn thành trò chuyện hay không."
  ],
  "VALIDATION_AI_1DDCF65F76": [
    "AI 服务请求失败（HTTP {p0}）：{p0}{p2}",
    "AI service request failed (HTTP {p0}): {p0}{p2}",
    "Yêu cầu dịch vụ AI không thành công (HTTP {p0}): {p0}{p2}"
  ],
  "VALIDATION_AI_9A64AC8642": [
    "AI 服务请求失败（HTTP {p0}），请检查模型名称、API额度和接口兼容性。{p2}",
    "AI service request failed (HTTP {p0}), please check the model name, API quota and interface compatibility. {p2}",
    "Yêu cầu dịch vụ AI không thành công (HTTP {p0}), vui lòng kiểm tra tên mô hình, hạn ngạch API và khả năng tương thích giao diện. {p2}"
  ],
  "VALIDATION_AI_6671077F61": [
    "AI 服务请求失败（HTTP {p0}）{p1}{p2}",
    "AI service request failed (HTTP {p0}) {p1}{p2}",
    "Yêu cầu dịch vụ AI không thành công (HTTP {p0}) {p1}{p2}"
  ],
  "VALIDATION_AI_5AA27A02B6": [
    "AI 服务报告错误：{p0}",
    "AI service reported error: {p0}",
    "Dịch vụ AI báo lỗi: {p0}"
  ],
  "VALIDATION_AI_15AAEDC95A": [
    "AI 服务报告错误，请检查模型和接口配置。",
    "The AI service reported an error, please check the model and interface configuration.",
    "Dịch vụ AI báo lỗi, vui lòng kiểm tra cấu hình model và giao diện."
  ],
  "VALIDATION_AI_AE37AB2A38": [
    "AI 服务报告错误{p0}",
    "AI service reported error {p0}",
    "Dịch vụ AI báo lỗi {p0}"
  ],
  "VALIDATION_AI_D868A25A20": [
    "AI 服务返回了{p0}格式；当前配置要求兼容 Chat Completions（choices[0].message）。请检查系统设置中的 API 基础地址。",
    "The AI service returned the {p0} format; the current configuration requires compatibility with Chat Completions (choices[0].message). Please check the API base address in your system settings.",
    "Dịch vụ AI trả về định dạng {p0}; cấu hình hiện tại yêu cầu khả năng tương thích với phần Hoàn thành trò chuyện (lựa chọn[0]. tin nhắn). Vui lòng kiểm tra địa chỉ cơ sở API trong cài đặt hệ thống của bạn."
  ],
  "VALIDATION_AI_3CD9D06A14": [
    "AI 服务返回了不支持的内容格式；需要文本或 Chat Completions 工具调用。",
    "The AI service returned an unsupported content format; text or Chat Completions tool call required.",
    "Dịch vụ AI trả về định dạng nội dung không được hỗ trợ; yêu cầu cuộc gọi bằng văn bản hoặc công cụ Hoàn thành trò chuyện."
  ],
  "VALIDATION_AI_A248023D90": [
    "AI 服务返回了无效工具调用列表。",
    "The AI service returned a list of invalid tool calls.",
    "Dịch vụ AI trả về danh sách lệnh gọi công cụ không hợp lệ."
  ],
  "VALIDATION_AI_C5A03F8BEC": [
    "AI 服务返回了不完整的工具调用；请检查模型是否支持 Function Calling。",
    "The AI ​​service returned an incomplete tool call; please check if the model supports Function Calling.",
    "Dịch vụ AI trả về lệnh gọi công cụ chưa hoàn chỉnh; vui lòng kiểm tra xem model này có hỗ trợ Gọi chức năng không."
  ],
  "VALIDATION_AI_EFFE575DE4": [
    "AI 服务因内容过滤没有生成回答。",
    "The AI service did not generate an answer due to content filtering.",
    "Dịch vụ AI không tạo ra câu trả lời do lọc nội dung."
  ],
  "VALIDATION_AI_DE101D6803": [
    "AI 服务没有返回文字或工具调用（结束原因：{p0}），请检查模型是否支持对话及工具调用。",
    "The AI service did not return text or tool calls (end reason: {p0}), please check whether the model supports dialogue and tool calls.",
    "Dịch vụ AI không trả lại cuộc gọi văn bản hoặc công cụ (lý do cuối cùng: {p0}), vui lòng kiểm tra xem mô hình có hỗ trợ cuộc gọi công cụ và hội thoại hay không."
  ],
  "VALIDATION_AI_DBDAD52BFD": [
    "AI 服务没有返回文字或工具调用，请检查模型是否支持对话及工具调用。",
    "The AI service did not return text or tool calls. Please check whether the model supports dialogue and tool calls.",
    "Dịch vụ AI không trả lại tin nhắn hoặc cuộc gọi công cụ. Vui lòng kiểm tra xem mô hình có hỗ trợ đối thoại và gọi công cụ hay không."
  ],
  "VALIDATION_AI_35ED25DA57": [
    "AI 服务没有返回文字或工具调用{p0}，请检查模型是否支持对话及工具调用。",
    "The AI service did not return text or tool call {p0}. Please check whether the model supports dialogue and tool calls.",
    "Dịch vụ AI không trả lại văn bản hoặc lệnh gọi công cụ {p0}. Vui lòng kiểm tra xem mô hình có hỗ trợ đối thoại và gọi công cụ hay không."
  ],
  "VALIDATION_AI_FAC62137C2": [
    "请先保存模型和 API Key。",
    "Please save the model and API Key first.",
    "Vui lòng lưu mô hình và Khóa API trước."
  ],
  "VALIDATION_AI_74DE33B90A": [
    "登录或权限已变化。",
    "Login or permissions have changed.",
    "Đăng nhập hoặc quyền đã thay đổi."
  ],
  "VALIDATION_AI_222149CF60": [
    "上一条 AI 请求仍在处理中。",
    "The last AI request is still being processed.",
    "Yêu cầu AI cuối cùng vẫn đang được xử lý."
  ],
  "VALIDATION_AI_F6EAB3B20E": [
    "请输入1–4000字的需求。",
    "Please enter your request of 1–4000 words.",
    "Vui lòng nhập yêu cầu của bạn từ 1–4000 từ."
  ],
  "VALIDATION_AI_74C0360580": [
    "附件名称无效。",
    "The attachment name is invalid.",
    "Tên tệp đính kèm không hợp lệ."
  ],
  "VALIDATION_AI_6D1E77DB26": [
    "文字与表格内容不能超过 1 MB。",
    "Text and table content cannot exceed 1 MB.",
    "Nội dung văn bản và bảng không được vượt quá 1 MB."
  ],
  "VALIDATION_AI_972BEFF9FD": [
    "今日 AI 请求额度已用完。",
    "The AI request quota has been exhausted today.",
    "Hạn ngạch yêu cầu AI ngày hôm nay đã hết."
  ],
  "VALIDATION_AI_B5B6BFDD58": [
    "本次对话已达长度限制，请开始新对话。",
    "This conversation has reached the length limit, please start a new conversation.",
    "Cuộc trò chuyện này đã đạt đến giới hạn độ dài, vui lòng bắt đầu cuộc trò chuyện mới."
  ],
  "VALIDATION_AI_55B8B7E210": [
    "每个对话最多添加 {p0} 张图片，请开始新对话。",
    "Add up to {p0} pictures per conversation, please start a new conversation.",
    "Thêm tối đa hình ảnh {p0} cho mỗi cuộc trò chuyện, vui lòng bắt đầu một cuộc trò chuyện mới."
  ],
  "VALIDATION_AI_DB1157BEF3": [
    "AI 工具调用格式无效。",
    "The AI tool call format is invalid.",
    "Định dạng lệnh gọi công cụ AI không hợp lệ."
  ],
  "VALIDATION_AI_3BB1E64E84": [
    "操作编号无效。",
    "Invalid operation number.",
    "Số hoạt động không hợp lệ."
  ],
  "VALIDATION_AI_439861AA89": [
    "操作不存在或无权确认。",
    "The operation does not exist or does not have permission to confirm.",
    "Hoạt động không tồn tại hoặc không có quyền xác nhận."
  ],
  "VALIDATION_AI_ADE2DC996E": [
    "已继续对话，此预览已取消，请重新生成。",
    "The conversation has been continued. This preview has been cancelled. Please regenerate.",
    "Cuộc trò chuyện đã được tiếp tục. Bản xem trước này đã bị hủy. Hãy tái sinh."
  ],
  "VALIDATION_AI_E0DEB30114": [
    "预览已过期，请重新生成。",
    "The preview has expired, please generate it again.",
    "Bản xem trước đã hết hạn, vui lòng tạo lại."
  ],
  "VALIDATION_AI_B619A6A3BA": [
    "模板或验收数据已变化，请重新生成图表预览。",
    "The template or acceptance data has changed, please regenerate the chart preview.",
    "Mẫu hoặc dữ liệu chấp nhận đã thay đổi, vui lòng tạo lại bản xem trước biểu đồ."
  ],
  "VALIDATION_AI_882CC506F8": [
    "库存或业务资料已变化，请重新生成预览。",
    "Inventory or business information has changed, please regenerate the preview.",
    "Thông tin hàng tồn kho hoặc doanh nghiệp đã thay đổi, vui lòng tạo lại bản xem trước."
  ],
  "VALIDATION_ANNOUNCEMENTS_8A7D46819C": [
    "仅管理员可以维护公告。",
    "Only administrators can maintain announcements.",
    "Chỉ quản trị viên mới có thể duy trì thông báo."
  ],
  "VALIDATION_ANNOUNCEMENTS_A1DC1B700F": [
    "公告筛选或分页参数无效。",
    "Announcement filtering or paging parameters are invalid.",
    "Các tham số lọc hoặc phân trang thông báo không hợp lệ."
  ],
  "VALIDATION_ANNOUNCEMENTS_C241B4E479": [
    "公告编号无效。",
    "The announcement number is invalid.",
    "Số thông báo không hợp lệ."
  ],
  "VALIDATION_ANNOUNCEMENTS_48B385E2EB": [
    "公告不存在或已被删除。",
    "The announcement does not exist or has been deleted.",
    "Thông báo không tồn tại hoặc đã bị xóa."
  ],
  "VALIDATION_ANNOUNCEMENTS_EEA45857D9": [
    "请提供公告正文版本。",
    "Please provide the text version of the announcement.",
    "Vui lòng cung cấp phiên bản văn bản của thông báo."
  ],
  "VALIDATION_ANNOUNCEMENTS_EC1E73161F": [
    "公告已更新，请重新打开后阅读。",
    "The announcement has been updated, please reopen it and read it.",
    "Thông báo đã được cập nhật, vui lòng mở lại và đọc."
  ],
  "VALIDATION_ANNOUNCEMENTS_B53B30C389": [
    "请填写 1–100 字标题和 1–10,000 字正文，并提供有效的置顶设置。",
    "Please provide a 1–100 word title and 1–10,000 word body text, with valid pin settings.",
    "Vui lòng cung cấp tiêu đề dài 1–100 từ và nội dung từ 1–10.000 từ, kèm theo cài đặt mã pin hợp lệ."
  ],
  "VALIDATION_ANNOUNCEMENTS_32A7E4DC05": [
    "公告内容或版本无效，请检查后重试。",
    "The announcement content or version is invalid, please check and try again.",
    "Nội dung hoặc phiên bản thông báo không hợp lệ, vui lòng kiểm tra và thử lại."
  ],
  "VALIDATION_ANNOUNCEMENTS_64D19DA701": [
    "公告已被其他管理员修改，请关闭后重新打开。",
    "The announcement has been modified by other administrators, please close and reopen it.",
    "Thông báo đã được các quản trị viên khác sửa đổi, vui lòng đóng và mở lại."
  ],
  "VALIDATION_ANNOUNCEMENTS_B0521C9106": [
    "请提供公告版本。",
    "Please provide an announcement version.",
    "Vui lòng cung cấp một phiên bản thông báo."
  ],
  "VALIDATION_ANNOUNCEMENTS_5235C6E46F": [
    "公告已更新，请重新打开后删除。",
    "The announcement has been updated, please reopen it and delete it.",
    "Thông báo đã được cập nhật, vui lòng mở lại và xóa nó."
  ],
  "VALIDATION_APP_4C3E5B2FF0": [
    "未找到该条码对应的物料，请先建立物料档案。",
    "The material corresponding to this barcode was not found. Please create a material file first.",
    "Không tìm thấy vật tư tương ứng với mã vạch này. Vui lòng tạo một tập tin vật liệu đầu tiên."
  ],
  "VALIDATION_APP_18205D1BD4": [
    "未找到该物料，请刷新后重试。",
    "The material was not found, please refresh and try again.",
    "Không tìm thấy vật tư, vui lòng làm mới và thử lại."
  ],
  "VALIDATION_APP_DB0D5F1A97": [
    "请填写有效的物料信息，条码可留空；手动条码需为 3–64 位字母、数字或 ._-，单价最多四位小数且不能为负数，预警值需为非负数且最多 4 位小数。",
    "Please fill in valid material information, and the barcode can be left blank; the manual barcode must be 3–64 characters, numbers, or ._-, the unit price must be a maximum of four decimal places and cannot be a negative number, and the warning value must be a non-negative number and must be a maximum of 4 decimal places.",
    "Vui lòng điền thông tin vật tư hợp lệ và mã vạch có thể để trống; mã vạch thủ công phải có 3–64 ký tự, số hoặc ._-, đơn giá phải có tối đa 4 chữ số thập phân và không được là số âm, đồng thời giá trị cảnh báo phải là số không âm và tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_APP_AEE2D14275": [
    "该条码已被使用，请使用其他条码。",
    "This barcode is already in use, please use another barcode.",
    "Mã vạch này đã được sử dụng, vui lòng sử dụng mã vạch khác."
  ],
  "VALIDATION_APP_BD879669C8": [
    "缺少物料版本，请刷新页面后重新编辑。",
    "The material version is missing, please refresh the page and edit again.",
    "Phiên bản vật tư bị thiếu, vui lòng làm mới trang và chỉnh sửa lại."
  ],
  "VALIDATION_APP_0ED0C192BD": [
    "物料信息已被修改，本次未保存。请查看最新信息后重新编辑。",
    "The material information has been modified and not saved this time. Please check the latest information and edit again.",
    "Thông tin vật tư đã được sửa đổi và không được lưu lần này. Vui lòng kiểm tra thông tin mới nhất và chỉnh sửa lại."
  ],
  "VALIDATION_APP_345AB3F710": [
    "物料不存在或不属于当前仓库。",
    "The material does not exist or does not belong to the current warehouse.",
    "Vật liệu không tồn tại hoặc không thuộc về kho hiện tại."
  ],
  "VALIDATION_APP_E65C926B60": [
    "物料或校验日期已变化，请刷新待校验列表后重试。",
    "The material or verification date has changed. Please refresh the list to be verified and try again.",
    "vật tư hoặc ngày xác minh đã thay đổi. Vui lòng làm mới danh sách để được xác minh và thử lại."
  ],
  "VALIDATION_APP_1CDB17EEFF": [
    "此物料尚未到校验日期或已停用，请刷新待校验列表。",
    "This material has not yet reached the verification date or has been deactivated. Please refresh the pending verification list.",
    "vật tư này chưa đến ngày xác minh hoặc đã bị vô hiệu hóa. Vui lòng làm mới danh sách xác minh đang chờ xử lý."
  ],
  "VALIDATION_APP_6F5258DB5E": [
    "请先选择要操作的物料。",
    "Please select the material to be operated first.",
    "Vui lòng chọn vật liệu sẽ được vận hành đầu tiên."
  ],
  "VALIDATION_APP_C375A46AB0": [
    "物料编号无效。",
    "The material number is invalid.",
    "Số vật liệu không hợp lệ."
  ],
  "VALIDATION_APP_AACC6FFAA2": [
    "单次批量操作最多支持 500 种物料。",
    "A single batch operation supports up to 500 materials.",
    "Một hoạt động hàng loạt hỗ trợ tới 500 vật liệu."
  ],
  "VALIDATION_APP_C8214523EA": [
    "请选择有效的启用或停用状态。",
    "Please select a valid enabled or disabled status.",
    "Vui lòng chọn trạng thái bật hoặc tắt hợp lệ."
  ],
  "VALIDATION_APP_FEDF252611": [
    "{p0} 种物料无法删除，本次未删除任何物料。",
    "{p0} materials cannot be deleted, and no materials have been deleted this time.",
    "Không thể xóa vật tư {p0} và lần này không có vật tư nào bị xóa."
  ],
  "VALIDATION_APP_23387BE1E1": [
    "请填写往来单位并至少添加一件物料。",
    "Please fill in the contact unit and add at least one item.",
    "Vui lòng điền vào đơn vị liên hệ và thêm ít nhất một mục."
  ],
  "VALIDATION_APP_F3748C45F4": [
    "请先确认清空全部业务数据。",
    "Please confirm to clear all business data first.",
    "Vui lòng xác nhận để xóa tất cả dữ liệu doanh nghiệp trước."
  ],
  "VALIDATION_APP_28BB4BE817": [
    "重置失败，数据未清空，请重试。",
    "The reset failed and the data was not cleared. Please try again.",
    "Việc thiết lập lại không thành công và dữ liệu không bị xóa. Vui lòng thử lại."
  ],
  "VALIDATION_APP_6C7EB54451": [
    "请输入 1–60 字的商户和仓库名称。",
    "Please enter a 1–60 character merchant and warehouse name.",
    "Vui lòng nhập tên người bán và tên kho từ 1–60 ký tự."
  ],
  "VALIDATION_APP_4DFE03481D": [
    "仓库名称已存在。",
    "The warehouse name already exists.",
    "Tên kho đã tồn tại."
  ],
  "VALIDATION_APP_6DE5AB4E33": [
    "接口不存在。",
    "The interface does not exist.",
    "Giao diện không tồn tại."
  ],
  "VALIDATION_APP_A134417300": [
    "提交内容过大，请减少行数或选择更小的文件。",
    "Submission is too large. Please reduce the number of lines or choose a smaller file.",
    "Nội dung gửi quá lớn. Vui lòng giảm số dòng hoặc chọn tệp nhỏ hơn."
  ],
  "VALIDATION_APP_76D8FBDAC9": [
    "提交内容不是有效的 JSON。",
    "Submission is not valid JSON.",
    "Nội dung gửi không phải là JSON hợp lệ."
  ],
  "VALIDATION_APP_7D50B786F0": [
    "请求格式错误。",
    "The request is malformed.",
    "Yêu cầu không đúng định dạng."
  ],
  "VALIDATION_APP_9B975432F8": [
    "服务暂时不可用，请稍后重试。",
    "The service is temporarily unavailable, please try again later.",
    "Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau."
  ],
  "VALIDATION_AUTH_56FB08F914": [
    "管理员账号迁移失败，数据库未改动：{p0}",
    "Administrator account migration failed, the database has not been changed: {p0}",
    "Di chuyển tài khoản quản trị viên không thành công, cơ sở dữ liệu chưa được thay đổi: {p0}"
  ],
  "VALIDATION_AUTH_AC4943EBCD": [
    "请从当前站点提交请求。",
    "Please submit a request from the current site.",
    "Vui lòng gửi yêu cầu từ trang web hiện tại."
  ],
  "VALIDATION_AUTH_DD61F75EEC": [
    "文件上传必须使用 multipart/form-data 格式。",
    "File uploads must use multipart/form-data format.",
    "Tệp tải lên phải sử dụng định dạng nhiều phần/biểu mẫu dữ liệu."
  ],
  "VALIDATION_AUTH_07948BD047": [
    "请求必须使用 JSON 格式。",
    "Requests must be in JSON format.",
    "Yêu cầu phải ở định dạng JSON."
  ],
  "VALIDATION_AUTH_DB4284BED5": [
    "尝试次数过多，请在 15 分钟后重试。",
    "Too many attempts, please try again in 15 minutes.",
    "Quá nhiều lần thử, vui lòng thử lại sau 15 phút."
  ],
  "VALIDATION_AUTH_B77709F086": [
    "请求过于频繁，请稍后重试。",
    "The request is too frequent, please try again later.",
    "Yêu cầu quá thường xuyên, vui lòng thử lại sau."
  ],
  "VALIDATION_AUTH_FB77CCC14A": [
    "管理员已设置，请直接登录。",
    "The administrator has set it up, please log in directly.",
    "Quản trị viên đã thiết lập, vui lòng đăng nhập trực tiếp."
  ],
  "VALIDATION_AUTH_BC083F3715": [
    "账号需为 3–32 位字母、数字或 ._-。",
    "Account number needs to be 3–32 letters, numbers, or ._-.",
    "Số tài khoản cần phải có từ 3–32 chữ cái, số hoặc ._-."
  ],
  "VALIDATION_AUTH_F11C87ED47": [
    "密码需为 8–128 位字符。",
    "Password needs to be 8–128 characters long.",
    "Mật khẩu cần dài 8–128 ký tự."
  ],
  "VALIDATION_AUTH_E76C363CAB": [
    "名称最多 60 个字。",
    "The name can be up to 60 characters long.",
    "Tên có thể dài tới 60 ký tự."
  ],
  "VALIDATION_AUTH_4EC54A465C": [
    "请选择有效的基准币种。",
    "Please select a valid base currency.",
    "Vui lòng chọn loại tiền tệ cơ bản hợp lệ."
  ],
  "VALIDATION_AUTH_C60C97D5DB": [
    "请先设置管理员。",
    "Please set up an administrator first.",
    "Vui lòng thiết lập quản trị viên trước."
  ],
  "VALIDATION_AUTH_6F14F790DA": [
    "账号或密码错误。",
    "The account or password is wrong.",
    "Tài khoản hoặc mật khẩu sai."
  ],
  "VALIDATION_AUTH_E2C9738883": [
    "请登录后继续操作。",
    "Please log in to continue.",
    "Vui lòng đăng nhập để tiếp tục."
  ],
  "VALIDATION_AUTH_57522829F5": [
    "当前登录账号已变化，请刷新后重试。",
    "The current login account has changed, please refresh and try again.",
    "Tài khoản đăng nhập hiện tại đã thay đổi, vui lòng làm mới và thử lại."
  ],
  "VALIDATION_AUTH_0CF1CF52ED": [
    "请选择有效的界面语言。",
    "Please select a valid interface language.",
    "Vui lòng chọn ngôn ngữ giao diện hợp lệ."
  ],
  "VALIDATION_AUTH_8A85A2B352": [
    "当前密码错误。",
    "The current password is wrong.",
    "Mật khẩu hiện tại sai."
  ],
  "VALIDATION_AUTH_A122560AFC": [
    "此岗位仅允许查看本组生产单并登记。",
    "This position is only allowed to view and register the production orders of this group.",
    "Vị trí này chỉ được phép xem và đăng ký lệnh sản xuất của nhóm này."
  ],
  "VALIDATION_AUTH_555F8A202E": [
    "没有此操作的权限，请联系管理员。",
    "If you do not have permission for this operation, please contact the administrator.",
    "Nếu bạn không có quyền thực hiện thao tác này, vui lòng liên hệ với quản trị viên."
  ],
  "VALIDATION_AUTH_E08C1E70A9": [
    "请填写有效账号、8–128 位密码、角色及最多 60 个字的名称。",
    "Please fill in a valid account number, 8-128 character password, role and a name of up to 60 characters.",
    "Vui lòng điền số tài khoản hợp lệ, mật khẩu 8-128 ký tự, vai trò và tên tối đa 60 ký tự."
  ],
  "VALIDATION_AUTH_961C7A24E9": [
    "登录或权限已变化，请重新登录。",
    "Login or permissions have changed, please log in again.",
    "Đăng nhập hoặc quyền đã thay đổi, vui lòng đăng nhập lại."
  ],
  "VALIDATION_AUTH_87D81CBC9C": [
    "该账号已存在。",
    "The account already exists.",
    "Tài khoản đã tồn tại."
  ],
  "VALIDATION_AUTH_40F5953C35": [
    "员工权限已改为岗位授权，请刷新页面，在岗位配置中修改权限或为员工调整岗位。",
    "Employee permissions have been changed to position authorization. Please refresh the page and modify the permissions in the position configuration or adjust positions for employees.",
    "Quyền của nhân viên đã được thay đổi thành ủy quyền vị trí. Vui lòng làm mới trang và sửa đổi quyền trong cấu hình vị trí hoặc điều chỉnh vị trí cho nhân viên."
  ],
  "VALIDATION_AUTH_B39AF49FB4": [
    "请选择有效角色、账号状态，并填写最多 60 个字的名称。",
    "Please select a valid role, account status, and fill in a name of up to 60 characters.",
    "Vui lòng chọn vai trò hợp lệ, trạng thái tài khoản và điền tên tối đa 60 ký tự."
  ],
  "VALIDATION_AUTH_5162812891": [
    "账号不存在。",
    "Account does not exist.",
    "Tài khoản không tồn tại."
  ],
  "VALIDATION_AUTH_95CFDC7081": [
    "不能停用或降级最后一个管理员。",
    "The last administrator cannot be deactivated or demoted.",
    "Quản trị viên cuối cùng không thể bị vô hiệu hóa hoặc giáng chức."
  ],
  "VALIDATION_AUTH_D49D0FBEEE": [
    "请通过调整岗位操作提交当前权限版本。",
    "Please submit the current permissions version by adjusting the position operation.",
    "Vui lòng gửi phiên bản quyền hiện tại bằng cách điều chỉnh hoạt động vị trí."
  ],
  "VALIDATION_AUTH_A6D4199053": [
    "请通过调整生产组操作提交当前权限版本。",
    "Please submit the current permissions version via the Adjust Production Group action.",
    "Vui lòng gửi phiên bản quyền hiện tại thông qua hành động Điều chỉnh nhóm sản xuất."
  ],
  "VALIDATION_BOM_E2E32E6E24": [
    "BOM筛选或分页参数无效。",
    "BOM filtering or paging parameters are invalid.",
    "Các tham số lọc hoặc phân trang BOM không hợp lệ."
  ],
  "VALIDATION_BOM_67A7965F27": [
    "BOM编号无效。",
    "The BOM number is invalid.",
    "Số BOM không hợp lệ."
  ],
  "VALIDATION_BOM_43E93759AB": [
    "BOM不存在或不属于当前仓库。",
    "The BOM does not exist or does not belong to the current warehouse.",
    "BOM không tồn tại hoặc không thuộc về kho hiện tại."
  ],
  "VALIDATION_BOM_7387231159": [
    "生产数量需为正数，最多 4 位小数。",
    "Production quantity needs to be a positive number with up to 4 decimal places.",
    "Số lượng sản xuất cần phải là số dương có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_BOM_ADD1DC70E9": [
    "BOM已变化，请重新打开后测算。",
    "The BOM has changed, please reopen it and calculate it.",
    "BOM đã thay đổi, bạn mở lại rồi tính nhé."
  ],
  "VALIDATION_BOM_DE5BCF4A0A": [
    "此BOM包含多层配方，请刷新页面后重新测算。",
    "This BOM contains multi-layer formulas, please refresh the page and recalculate.",
    "BOM này chứa công thức nhiều lớp, vui lòng tải lại trang và tính toán lại."
  ],
  "VALIDATION_BOM_CFC4D73DD2": [
    "备份BOM明细关联或排序无效。",
    "The backup BOM details association or sorting is invalid.",
    "Liên kết hoặc sắp xếp chi tiết BOM sao lưu không hợp lệ."
  ],
  "VALIDATION_BOM_470DD5B2D1": [
    "备份 BOM 废料关联无效。",
    "Backup BOM scrap association is invalid.",
    "Liên kết phế liệu BOM sao lưu không hợp lệ."
  ],
  "VALIDATION_BOM_E7E2C5F048": [
    "备份 BOM 废料排序或仓库关联无效。",
    "Invalid backup BOM scrap sorting or warehouse association.",
    "Phân loại phế liệu BOM dự phòng hoặc liên kết kho không hợp lệ."
  ],
  "VALIDATION_BOM_5E231727BD": [
    "备份BOM字段或仓库关联无效。",
    "The backup BOM field or warehouse association is invalid.",
    "Trường BOM dự phòng hoặc liên kết kho không hợp lệ."
  ],
  "VALIDATION_BOM_4528EEFD54": [
    "该物料已有同名BOM，请使用不同的配方名称。",
    "This material already has a BOM with the same name, please use a different recipe name.",
    "Nguyên liệu này đã có BOM có cùng tên, vui lòng sử dụng tên công thức khác."
  ],
  "VALIDATION_BOM_36F4164136": [
    "BOM已被修改，请重新打开后再保存。当前填写内容已保留。",
    "The BOM has been modified, please reopen it and save it. The currently filled content has been retained.",
    "BOM đã được sửa đổi, vui lòng mở lại và lưu lại. Nội dung hiện đang điền đã được giữ lại."
  ],
  "VALIDATION_BOM_8C6B5BB8C7": [
    "基准产量及材料用量最多 4 位小数。",
    "Baseline output and material usage are to a maximum of 4 decimal places.",
    "Sản lượng cơ bản và mức sử dụng vật liệu tối đa là 4 chữ số thập phân."
  ],
  "VALIDATION_BOM_1AAA7990AA": [
    "请选择当前仓库已启用的成品物料。",
    "Please select the finished product material that is enabled in the current warehouse.",
    "Vui lòng chọn nguyên liệu thành phẩm được kích hoạt trong kho hiện tại."
  ],
  "VALIDATION_BOM_BD436D79B0": [
    "成品单位已变化，请重新选择成品并核对基准产量。",
    "The finished product unit has changed, please reselect the finished product and check the baseline output.",
    "Đơn vị thành phẩm đã thay đổi, vui lòng chọn lại thành phẩm và kiểm tra đầu ra cơ bản."
  ],
  "VALIDATION_BOM_882552F71C": [
    "请选择当前物料在当前仓库的下级配方。",
    "Please select the subordinate formula of the current material in the current warehouse.",
    "Vui lòng chọn công thức phụ của nguyên liệu hiện tại trong kho hiện tại."
  ],
  "VALIDATION_BOM_015A5E1227": [
    "所选下级配方已停用，请选择已启用的配方。",
    "The selected subordinate recipe is disabled, please select an enabled recipe.",
    "Công thức phụ đã chọn bị vô hiệu hóa, vui lòng chọn một công thức đã bật."
  ],
  "VALIDATION_BOM_37298660B2": [
    "材料不存在、已停用或不属于当前仓库，请重新选择。",
    "The material does not exist, has been deactivated, or does not belong to the current warehouse. Please select again.",
    "Vật liệu không tồn tại, đã bị vô hiệu hóa hoặc không thuộc về kho hiện tại. Vui lòng chọn lại."
  ],
  "VALIDATION_BOM_79926B5BCE": [
    "材料单位已变化，请重新选择材料并核对用量。",
    "The material unit has changed, please reselect the material and check the usage.",
    "Đơn vị vật liệu đã thay đổi, vui lòng chọn lại vật liệu và kiểm tra cách sử dụng."
  ],
  "VALIDATION_BOM_C0F1B91301": [
    "此配方已被上级BOM引用，请先处理上级关联后再更换成品。",
    "This recipe has been referenced by the superior BOM. Please deal with the superior association first and then replace the finished product.",
    "Công thức này đã được BOM cấp trên tham khảo. Hãy giải quyết với hiệp hội cấp trên trước rồi thay thế thành phẩm."
  ],
  "VALIDATION_BOM_EC67362C8E": [
    "启用状态无效。",
    "The enabled status is invalid.",
    "Trạng thái kích hoạt không hợp lệ."
  ],
  "VALIDATION_BOM_3F4AEFDC6A": [
    "BOM已被修改，请刷新列表后再删除。",
    "The BOM has been modified, please refresh the list before deleting it.",
    "BOM đã được sửa đổi, vui lòng làm mới danh sách trước khi xóa."
  ],
  "VALIDATION_BOM_A814D38025": [
    "此配方已被上级BOM引用，请先解除关联，或改为停用。",
    "This recipe has been referenced by the superior BOM. Please disassociate it first or deactivate it.",
    "Công thức này đã được BOM cấp trên tham khảo. Vui lòng tách nó ra trước hoặc hủy kích hoạt nó."
  ],
  "VALIDATION_BOM_8ACA355C8D": [
    "此配方已被生产单引用，不能删除，可改为停用。",
    "This recipe has been referenced by the production order and cannot be deleted. It can be deactivated instead.",
    "Công thức này đã được tham chiếu theo lệnh sản xuất và không thể xóa được. Thay vào đó, nó có thể bị vô hiệu hóa."
  ],
  "VALIDATION_CATALOG_622CBFA297": [
    "备注最多 {p1} 字。",
    "Notes can be up to {p1} words long.",
    "Ghi chú có thể dài tới {p1} từ."
  ],
  "VALIDATION_CATALOG_F032966706": [
    "规格型号最多 {p1} 字。",
    "The specification model can contain up to {p1} characters.",
    "Mô hình thông số kỹ thuật có thể chứa tối đa ký tự {p1}."
  ],
  "VALIDATION_CATALOG_E9CB5AF48A": [
    "{p0}最多 {p1} 字。",
    "{p0} is at most {p1} words.",
    "{p0} có nhiều nhất là {p1} từ."
  ],
  "VALIDATION_CATALOG_0A0E94A311": [
    "固定资产标记无效。",
    "Fixed asset tag is invalid.",
    "Thẻ tài sản cố định không hợp lệ."
  ],
  "VALIDATION_CATALOG_842158C5A7": [
    "单位是否取整标记无效。",
    "The unit rounding flag is invalid.",
    "Cờ làm tròn đơn vị không hợp lệ."
  ],
  "VALIDATION_CATALOG_AC5611EF34": [
    "分类名称或上级分类无效。",
    "The category name or parent category is invalid.",
    "Tên danh mục hoặc danh mục gốc không hợp lệ."
  ],
  "VALIDATION_CATALOG_1D0D4140F5": [
    "上级分类必须属于同一仓库。",
    "The parent category must belong to the same warehouse.",
    "Danh mục gốc phải thuộc cùng một kho."
  ],
  "VALIDATION_CATALOG_280A787C5F": [
    "同级分类名称不能重复。",
    "Classification names at the same level cannot be repeated.",
    "Tên phân loại ở cùng cấp độ không thể được lặp lại."
  ],
  "VALIDATION_CATALOG_CBE1F2483F": [
    "分类不能移到自身或下级分类中。",
    "Categories cannot be moved to themselves or to subordinate categories.",
    "Các danh mục không thể được chuyển đến chính chúng hoặc các danh mục phụ."
  ],
  "VALIDATION_CATALOG_8E2C361E34": [
    "分类最多支持 10 层。",
    "Classification supports up to 10 levels.",
    "Phân loại hỗ trợ lên đến 10 cấp độ."
  ],
  "VALIDATION_CATALOG_4D066B6289": [
    "物料分类或仓库关联无效。",
    "Invalid material classification or warehouse association.",
    "Phân loại vật liệu hoặc liên kết kho không hợp lệ."
  ],
  "VALIDATION_CATALOG_125DF6E885": [
    "分类迁移后的数据关联无效。",
    "Data association after classification migration is invalid.",
    "Liên kết dữ liệu sau khi di chuyển phân loại không hợp lệ."
  ],
  "VALIDATION_CATALOG_1CCC40C90F": [
    "物料分类不存在。",
    "Material classification does not exist.",
    "Phân loại vật liệu không tồn tại."
  ],
  "VALIDATION_CATALOG_DA73720C63": [
    "物料分类树无效。",
    "The material classification tree is invalid.",
    "Cây phân loại vật liệu không hợp lệ."
  ],
  "VALIDATION_CATALOG_2A4074B65A": [
    "上级分类不存在。",
    "The upper level category does not exist.",
    "Danh mục cấp cao hơn không tồn tại."
  ],
  "VALIDATION_CATALOG_BC33313CF1": [
    "请选择当前仓库的有效物料分类。",
    "Please select a valid material classification for the current warehouse.",
    "Vui lòng chọn phân loại vật liệu hợp lệ cho kho hiện tại."
  ],
  "VALIDATION_CATALOG_D881A8211E": [
    "分类名称最多 100 字，请选择已有分类。",
    "The category name can be up to 100 characters, please select an existing category.",
    "Tên danh mục có thể dài tối đa 100 ký tự, vui lòng chọn danh mục hiện có."
  ],
  "VALIDATION_CATALOG_43810C1D9E": [
    "请填写 1–100 字的分类名称。",
    "Please enter a category name of 1–100 words.",
    "Vui lòng nhập tên danh mục từ 1–100 từ."
  ],
  "VALIDATION_CATALOG_0732EC07C7": [
    "上级分类不存在或不属于当前仓库。",
    "The superior category does not exist or does not belong to the current warehouse.",
    "Danh mục ưu việt không tồn tại hoặc không thuộc về kho hiện tại."
  ],
  "VALIDATION_CATALOG_B402301430": [
    "分类不存在或不属于当前仓库。",
    "The category does not exist or does not belong to the current warehouse.",
    "Danh mục này không tồn tại hoặc không thuộc về kho hiện tại."
  ],
  "VALIDATION_CATALOG_084C63D6CC": [
    "请先移走下级分类和物料，再删除分类。",
    "Please remove lower-level categories and materials first, and then delete the category.",
    "Vui lòng loại bỏ các danh mục và vật tư cấp thấp hơn trước, sau đó xóa danh mục."
  ],
  "VALIDATION_CATALOG_A61B880AFB": [
    "分类不存在。",
    "Category does not exist.",
    "Danh mục không tồn tại."
  ],
  "VALIDATION_COMMERCE_8AC6C23A59": [
    "金额需为非负数，最多两位小数。",
    "The amount needs to be a non-negative number with up to two decimal places.",
    "Số tiền phải là số không âm có tối đa hai chữ số thập phân."
  ],
  "VALIDATION_COMMERCE_AD28876C93": [
    "往来单位不存在、已停用或类型不匹配。",
    "The corresponding unit does not exist, is deactivated, or the type does not match.",
    "Đơn vị tương ứng không tồn tại, bị vô hiệu hóa hoặc loại không khớp."
  ],
  "VALIDATION_COMMERCE_74FE9C5062": [
    "存在同名往来单位，请明确选择单位。",
    "There is a unit with the same name, please select the unit clearly.",
    "Có đơn vị trùng tên vui lòng chọn rõ đơn vị."
  ],
  "VALIDATION_COMMERCE_6E1EEDAAB7": [
    "此往来单位已停用，请先启用或选择其他单位。",
    "This organization has been disabled. Please activate or select another organization first.",
    "Tổ chức này đã bị vô hiệu hóa. Vui lòng kích hoạt hoặc chọn một tổ chức khác trước."
  ],
  "VALIDATION_COMMERCE_1ECAA55ADD": [
    "库存成本数据无效。",
    "Invalid inventory cost data.",
    "Dữ liệu chi phí hàng tồn kho không hợp lệ."
  ],
  "VALIDATION_COMMERCE_977537DDFA": [
    "库存不足或超出上限。",
    "Inventory is low or exceeds the limit.",
    "Hàng tồn kho thấp hoặc vượt quá giới hạn."
  ],
  "VALIDATION_COMMERCE_60C15E7D28": [
    "库存成本不足或超出范围，请使用退货或盘点纠正后续业务。",
    "If the inventory cost is insufficient or out of range, please use returns or inventory to correct subsequent business.",
    "Nếu chi phí hàng tồn kho không đủ hoặc nằm ngoài phạm vi, vui lòng sử dụng hàng trả lại hoặc hàng tồn kho để điều chỉnh hoạt động kinh doanh tiếp theo."
  ],
  "VALIDATION_COMMERCE_E15EF7B3A4": [
    "后续交易已改变库存成本，不能直接作废此单，请使用退货处理。",
    "Subsequent transactions have changed the inventory cost and this order cannot be directly voided. Please use return processing.",
    "Các giao dịch tiếp theo đã thay đổi chi phí tồn kho và đơn hàng này không thể bị hủy trực tiếp. Vui lòng sử dụng xử lý trả lại."
  ],
  "VALIDATION_COMMERCE_0FE2B937B1": [
    "请填写模板名称并添加 1–100 种物料。",
    "Please fill in the template name and add 1–100 items.",
    "Vui lòng điền tên mẫu và thêm 1–100 mục."
  ],
  "VALIDATION_COMMERCE_C417FEA562": [
    "模板往来单位无效。",
    "The template correspondent unit is invalid.",
    "Đơn vị tương ứng mẫu không hợp lệ."
  ],
  "VALIDATION_COMMERCE_9DA2B144ED": [
    "模板物料无效，请填写正数数量（最多 4 位小数）和最多四位小数的非负单价。",
    "The template material is invalid, please fill in a positive quantity (up to 4 decimal places) and a non-negative unit price up to 4 decimal places.",
    "vật tư mẫu không hợp lệ, vui lòng điền số lượng dương (tối đa 4 chữ số thập phân) và đơn giá không âm tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_COMMERCE_B9697022AC": [
    "请填写名称，检查联系人、电话、地址和备注长度。",
    "Please fill in name, check contact person, phone number, address and note length.",
    "Vui lòng điền tên, kiểm tra người liên hệ, số điện thoại, địa chỉ và độ dài ghi chú."
  ],
  "VALIDATION_COMMERCE_565B0B3559": [
    "同类往来单位名称已存在。",
    "Similar unit names already exist.",
    "Tên đơn vị tương tự đã tồn tại."
  ],
  "VALIDATION_COMMERCE_F674E31B21": [
    "往来单位已变化，请刷新；已有记录不能更换类型。",
    "The corresponding unit has changed, please refresh; the type cannot be changed if there are existing records.",
    "Đơn vị tương ứng đã thay đổi, vui lòng làm mới; loại không thể thay đổi nếu có hồ sơ hiện có."
  ],
  "VALIDATION_COMMERCE_8DB38471C9": [
    "往来单位已变化或已删除，请刷新后重试。",
    "The corresponding unit has changed or been deleted, please refresh and try again.",
    "Đơn vị tương ứng đã thay đổi hoặc bị xóa, vui lòng làm mới và thử lại."
  ],
  "VALIDATION_COMMERCE_EC619921BB": [
    "此客户已关联物料客户料号，不能删除；可停用以保留记录。",
    "This customer has associated material customer number and cannot be deleted; it can be deactivated to retain records.",
    "Khách hàng này có mã số khách hàng quan trọng được liên kết và không thể xóa được; nó có thể bị vô hiệu hóa để giữ lại hồ sơ."
  ],
  "VALIDATION_COMMERCE_209FB375C5": [
    "此往来单位已关联单据、模板或出入库二维码，不能删除；可停用以保留历史记录。",
    "This transaction unit has been associated with documents, templates or warehouse entry and exit QR codes and cannot be deleted; it can be deactivated to retain historical records.",
    "Đơn vị giao dịch này đã được liên kết với các tài liệu, biểu mẫu hoặc mã QR xuất nhập kho và không thể xóa được; nó có thể bị vô hiệu hóa để giữ lại các hồ sơ lịch sử."
  ],
  "VALIDATION_COMMERCE_D05BAE0D7D": [
    "模板已被修改或删除，请重新选择模板。",
    "The template has been modified or deleted, please select another template.",
    "Mẫu đã được sửa đổi hoặc xóa, vui lòng chọn mẫu khác."
  ],
  "VALIDATION_COMMERCE_50B6A2FF69": [
    "模板已变化，请刷新。",
    "The template has changed, please refresh.",
    "Mẫu đã thay đổi, vui lòng làm mới."
  ],
  "VALIDATION_COMMERCE_8162C85022": [
    "单据不存在。",
    "The document does not exist.",
    "Tài liệu này không tồn tại."
  ],
  "VALIDATION_COMMERCE_A17E5EEC4F": [
    "内部流转不涉及收付款。",
    "Internal transfers do not involve receipts or payments.",
    "Chuyển khoản nội bộ không liên quan đến việc nhận hoặc thanh toán."
  ],
  "VALIDATION_COMMERCE_3C7D1F1FC9": [
    "请确认将此历史单据纳入收付款管理。",
    "Please confirm that this historical document is included in collection and payment management.",
    "Vui lòng xác nhận rằng tài liệu lịch sử này được đưa vào quản lý thu và thanh toán."
  ],
  "VALIDATION_COMMERCE_6B6F48D0D8": [
    "已收付金额超过单据总额或缺少核对说明。",
    "The paid amount exceeds the total amount of the document or the verification instructions are missing.",
    "Số tiền thanh toán vượt quá tổng số tiền của tài liệu hoặc thiếu hướng dẫn xác minh."
  ],
  "VALIDATION_COMMERCE_C8D185C336": [
    "单据不存在、已作废或尚未核对收付款。",
    "The document does not exist, has been invalidated, or has not yet been verified for receipt and payment.",
    "Tài liệu không tồn tại, đã bị vô hiệu hoặc chưa được xác minh để nhận và thanh toán."
  ],
  "VALIDATION_COMMERCE_90D17D0D6C": [
    "金额必须大于零且不能超过待收付金额，请填写收付款方式。",
    "The amount must be greater than zero and cannot exceed the amount to be collected and paid. Please fill in the payment method.",
    "Số tiền phải lớn hơn 0 và không được vượt quá số tiền phải thu, nộp. Vui lòng điền vào phương thức thanh toán."
  ],
  "VALIDATION_COMMERCE_564DF26034": [
    "请填写撤销原因。",
    "Please fill in the reason for cancellation.",
    "Vui lòng điền lý do hủy."
  ],
  "VALIDATION_COMMERCE_FACD321305": [
    "收付款记录不存在或已经撤销。",
    "The payment record does not exist or has been revoked.",
    "Hồ sơ thanh toán không tồn tại hoặc đã bị thu hồi."
  ],
  "VALIDATION_COMMERCE_F1236A9792": [
    "请选择有效的起止日期。",
    "Please select valid start and end dates.",
    "Vui lòng chọn ngày bắt đầu và ngày kết thúc hợp lệ."
  ],
  "VALIDATION_CURRENCY_C91C92F3E8": [
    "请选择有效的显示币种。",
    "Please select a valid display currency.",
    "Vui lòng chọn loại tiền tệ hiển thị hợp lệ."
  ],
  "VALIDATION_CURRENCY_06553CF162": [
    "汇率需为大于 0 的有效数字。",
    "The exchange rate needs to be a valid number greater than 0.",
    "Tỷ giá hối đoái cần phải là một số hợp lệ lớn hơn 0."
  ],
  "VALIDATION_CURRENCY_717081B4BB": [
    "汇率数据无效",
    "Invalid exchange rate data",
    "Dữ liệu tỷ giá hối đoái không hợp lệ"
  ],
  "VALIDATION_CURRENCY_42DF3855B4": [
    "获取汇率超时，请检查网络后重试。",
    "Timeout for obtaining the exchange rate, please check the network and try again.",
    "Đã hết thời gian nhận tỷ giá hối đoái, vui lòng kiểm tra mạng và thử lại."
  ],
  "VALIDATION_CURRENCY_E14D983F31": [
    "暂时无法获取最新汇率，请稍后重试或手动填写。",
    "The latest exchange rate cannot be obtained at the moment, please try again later or fill it in manually.",
    "Hiện tại không thể lấy được tỷ giá hối đoái mới nhất, vui lòng thử lại sau hoặc điền thủ công."
  ],
  "VALIDATION_CUSTOMER_PART_NUMBERS_A85E90D30F": [
    "每种物料最多配置 100 条客户料号。",
    "Each material can be configured with up to 100 customer material numbers.",
    "Mỗi vật liệu có thể được cấu hình với tối đa 100 mã số vật liệu của khách hàng."
  ],
  "VALIDATION_CUSTOMER_PART_NUMBERS_A8E4CA7486": [
    "请选择客户并填写 1–100 字的客户料号。",
    "Please select a customer and fill in a 1-100 word customer part number.",
    "Vui lòng chọn một khách hàng và điền số bộ phận của khách hàng từ 1-100 từ."
  ],
  "VALIDATION_CUSTOMER_PART_NUMBERS_F4498BC456": [
    "客户料号关联的客户不存在或类型无效。",
    "The customer associated with the customer material number does not exist or the type is invalid.",
    "Khách hàng được liên kết với số tài liệu của khách hàng không tồn tại hoặc loại không hợp lệ."
  ],
  "VALIDATION_CUSTOMER_PART_NUMBERS_4AFE0E1E6D": [
    "不能为已停用的客户新增或修改客户料号。",
    "Customer item numbers cannot be added or modified for deactivated customers.",
    "Số mặt hàng của khách hàng không thể được thêm hoặc sửa đổi đối với khách hàng đã ngừng hoạt động."
  ],
  "VALIDATION_CUSTOMER_PART_NUMBERS_7F467C2233": [
    "同一客户的料号不能重复。",
    "The material number of the same customer cannot be repeated.",
    "Số vật liệu của cùng một khách hàng không thể lặp lại."
  ],
  "VALIDATION_IMAGEBED_429A6B5914": [
    "物料图片 URL 无效。",
    "Item image URL is invalid.",
    "URL hình ảnh mặt hàng không hợp lệ."
  ],
  "VALIDATION_IMAGEBED_F651FD689E": [
    "物料图片需为 HTTPS URL。",
    "Material images need to be HTTPS URLs.",
    "Hình ảnh quan trọng cần phải là URL HTTPS."
  ],
  "VALIDATION_IMAGEBED_54C7B8F90B": [
    "物料图片需为不含账号、密码或片段的 HTTPS URL。",
    "Material images need to be HTTPS URLs without account numbers, passwords or fragments.",
    "Hình ảnh quan trọng cần phải là URL HTTPS không có số tài khoản, mật khẩu hoặc đoạn."
  ],
  "VALIDATION_IMAGEBED_7BC89A00E2": [
    "请先在设置中配置图床，再上传物料图片。",
    "Please configure the image bed in the settings first, and then upload the material image.",
    "Vui lòng định cấu hình giường hình ảnh trong cài đặt trước, sau đó tải hình ảnh vật liệu lên."
  ],
  "VALIDATION_IMAGEBED_E90857CB9C": [
    "请使用当前图床上传返回的物料图片 URL。",
    "Please use the material image URL returned by the current image bed upload.",
    "Vui lòng sử dụng URL hình ảnh vật liệu được tải lên giường hình ảnh hiện tại trả về."
  ],
  "VALIDATION_IMAGEBED_A663703AB2": [
    "请填写有效的 HTTPS 图床地址。",
    "Please fill in a valid HTTPS image bed address.",
    "Vui lòng điền địa chỉ giường hình ảnh HTTPS hợp lệ."
  ],
  "VALIDATION_IMAGEBED_440FB87AD7": [
    "图床地址需为 HTTPS 域名，例如 https://img.example.com，不包含上传路径。",
    "The image bed address must be an HTTPS domain name, such as https://img.example.com, and does not include the upload path.",
    "Địa chỉ giường hình ảnh phải là tên miền HTTPS, chẳng hạn như https://img.example.com và không bao gồm đường dẫn tải lên."
  ],
  "VALIDATION_IMAGEBED_E0418573A5": [
    "图床认证方式无效。",
    "The image bed authentication method is invalid.",
    "Phương thức xác thực giường hình ảnh không hợp lệ."
  ],
  "VALIDATION_IMAGEBED_F762EED4D7": [
    "图床凭据格式无效。",
    "The image bed credential format is invalid.",
    "Định dạng thông tin xác thực của giường hình ảnh không hợp lệ."
  ],
  "VALIDATION_IMAGEBED_C835017CF5": [
    "上传目录或渠道名称过长。",
    "The upload directory or channel name is too long.",
    "Thư mục tải lên hoặc tên kênh quá dài."
  ],
  "VALIDATION_IMAGEBED_E27FF52222": [
    "上传目录不能包含空目录、路径穿越或特殊字符。",
    "The upload directory cannot contain empty directories, path traversals, or special characters.",
    "Thư mục tải lên không được chứa các thư mục trống, đường dẫn duyệt hoặc ký tự đặc biệt."
  ],
  "VALIDATION_IMAGEBED_8795057400": [
    "渠道名称格式无效。",
    "Channel name format is invalid.",
    "Định dạng tên kênh không hợp lệ."
  ],
  "VALIDATION_IMAGEBED_5627A7F0AB": [
    "请填写图床上传凭据。",
    "Please fill in the image upload credentials.",
    "Vui lòng điền thông tin tải lên hình ảnh."
  ],
  "VALIDATION_IMAGEBED_AA01CB1536": [
    "请先由管理员在设置中配置图床。",
    "Please let the administrator configure the image bed in the settings first.",
    "Vui lòng cho phép quản trị viên định cấu hình giường hình ảnh trong cài đặt trước."
  ],
  "VALIDATION_IMAGEBED_62915F30FE": [
    "图片上传过于频繁，请稍后重试。",
    "Image uploads are too frequent, please try again later.",
    "Tải lên hình ảnh quá thường xuyên, vui lòng thử lại sau."
  ],
  "VALIDATION_IMAGEBED_FB3A35DA05": [
    "上传图片不能超过 1 MB，请先压缩。",
    "The uploaded image cannot exceed 1 MB, please compress it first.",
    "Hình ảnh tải lên không được vượt quá 1 MB, vui lòng nén nó trước."
  ],
  "VALIDATION_IMAGEBED_0551F8073D": [
    "请仅上传一个图片文件。",
    "Please upload only one image file.",
    "Vui lòng chỉ tải lên một tập tin hình ảnh."
  ],
  "VALIDATION_IMAGEBED_A70510D9EF": [
    "图片无效，请选择有效的 JPEG、PNG 或 WebP 图片（压缩后不超过 1 MB）。",
    "Invalid image, please select a valid JPEG, PNG, or WebP image (maximum 1 MB compressed).",
    "Hình ảnh không hợp lệ, vui lòng chọn hình ảnh JPEG, PNG hoặc WebP hợp lệ (nén tối đa 1 MB)."
  ],
  "VALIDATION_IMAGEBED_CBE6CD279A": [
    "图床认证失败，请检查上传凭据及上传权限。",
    "Image bed authentication failed, please check the upload credentials and upload permissions.",
    "Xác thực giường hình ảnh không thành công, vui lòng kiểm tra thông tin xác thực tải lên và quyền tải lên."
  ],
  "VALIDATION_IMAGEBED_6E0B6F7CEA": [
    "图床上传失败，请检查 cfr2 渠道配置后重试。",
    "The image upload failed. Please check the cfr2 channel configuration and try again.",
    "Tải lên hình ảnh không thành công. Vui lòng kiểm tra cấu hình kênh cfr2 và thử lại."
  ],
  "VALIDATION_IMAGEBED_797013F634": [
    "图床上传超时，请重试。",
    "The image upload timed out, please try again.",
    "Đã hết thời gian tải lên hình ảnh, vui lòng thử lại."
  ],
  "VALIDATION_IMAGEBED_A6CFCC4898": [
    "图床连接或响应异常，请检查图床地址后重试。",
    "The image bed connection or response is abnormal. Please check the image bed address and try again.",
    "Kết nối hoặc phản hồi của giường hình ảnh là bất thường. Vui lòng kiểm tra địa chỉ giường trong hình ảnh và thử lại."
  ],
  "VALIDATION_MULTI_STOCKTAKE_6782CC0583": [
    "请输入有效的搜索内容，最多 100 字。",
    "Please enter a valid search term, up to 100 words.",
    "Vui lòng nhập cụm từ tìm kiếm hợp lệ, tối đa 100 từ."
  ],
  "VALIDATION_MULTI_STOCKTAKE_63914355F4": [
    "请选择当前仓库作为对照基准。",
    "Please select the current warehouse as the baseline.",
    "Vui lòng chọn kho hiện tại làm đường cơ sở."
  ],
  "VALIDATION_MULTI_STOCKTAKE_6CA709E4AF": [
    "仓库不存在，请重新选择。",
    "The warehouse does not exist, please select again.",
    "Kho không tồn tại, vui lòng chọn lại."
  ],
  "VALIDATION_MULTI_STOCKTAKE_81E11A988A": [
    "物料已删除或不属于当前仓库，请重新选择。",
    "The material has been deleted or does not belong to the current warehouse, please select again.",
    "Vật liệu đã bị xóa hoặc không thuộc kho hiện tại, vui lòng chọn lại."
  ],
  "VALIDATION_NOTIFICATIONS_1E8AC117BA": [
    "通知配置已变化，请重新打开设置后修改。",
    "The notification configuration has changed, please reopen the settings and modify it.",
    "Cấu hình thông báo đã thay đổi, vui lòng mở lại cài đặt và sửa đổi."
  ],
  "VALIDATION_NOTIFICATIONS_D9DFF38825": [
    "请选择有效的通知类型、仓库和通知格式。",
    "Please select a valid notification type, repository, and notification format.",
    "Vui lòng chọn loại thông báo, kho lưu trữ và định dạng thông báo hợp lệ."
  ],
  "VALIDATION_NOTIFICATIONS_4841646C65": [
    "请填写有效的汇总时间和时区。",
    "Please fill in a valid rollup time and time zone.",
    "Vui lòng điền thời gian và múi giờ tổng hợp hợp lệ."
  ],
  "VALIDATION_NOTIFICATIONS_B30439206F": [
    "时区无效，例如 Asia/Shanghai 或 UTC。",
    "Invalid time zone, such as Asia/Shanghai or UTC.",
    "Múi giờ không hợp lệ, chẳng hạn như Châu Á/Thượng Hải hoặc UTC."
  ],
  "VALIDATION_NOTIFICATIONS_F018408F65": [
    "Webhook 地址或签名密钥格式无效。",
    "The webhook address or signing key format is invalid.",
    "Địa chỉ webhook hoặc định dạng khóa ký không hợp lệ."
  ],
  "VALIDATION_NOTIFICATIONS_7018546035": [
    "请先填写 Webhook 地址。",
    "Please fill in the webhook address first.",
    "Vui lòng điền địa chỉ webhook trước."
  ],
  "VALIDATION_NOTIFICATIONS_F61570C0B0": [
    "通知配置已变化，请重新打开设置。",
    "Notification configuration has changed, please reopen settings.",
    "Cấu hình thông báo đã thay đổi, vui lòng mở lại cài đặt."
  ],
  "VALIDATION_NOTIFICATIONS_883F8CAFCB": [
    "请先保存 Webhook 地址。",
    "Please save the webhook address first.",
    "Hãy lưu địa chỉ webhook trước."
  ],
  "VALIDATION_NOTIFICATIONS_30D42B26F4": [
    "请等待 30 秒后再发送测试通知。",
    "Please wait 30 seconds before sending a test notification.",
    "Vui lòng đợi 30 giây trước khi gửi thông báo kiểm tra."
  ],
  "VALIDATION_NOTIFICATIONS_0D5B3F746D": [
    "这条记录不能重试，请检查通知配置和发送状态。",
    "This record cannot be retried, please check the notification configuration and sending status.",
    "Không thể thử lại bản ghi này, vui lòng kiểm tra cấu hình thông báo và trạng thái gửi."
  ],
  "VALIDATION_OPERATIONS_D9171A9B1D": [
    "请填写操作原因（最多 500 字）。",
    "Please fill in the reason for the operation (maximum 500 words).",
    "Vui lòng điền lý do thực hiện thao tác (tối đa 500 từ)."
  ],
  "VALIDATION_OPERATIONS_BE0349A2CD": [
    "缺少操作标识，请重新打开页面。",
    "The operation identifier is missing, please reopen the page.",
    "Mã định danh hoạt động bị thiếu, vui lòng mở lại trang."
  ],
  "VALIDATION_OPERATIONS_0574B2BF31": [
    "操作标识重复，请刷新后重试。",
    "The operation ID is repeated, please refresh and try again.",
    "ID hoạt động được lặp lại, vui lòng làm mới và thử lại."
  ],
  "VALIDATION_OPERATIONS_8F87836052": [
    "物料不存在，请刷新。",
    "The material does not exist, please refresh.",
    "vật tư không tồn tại, vui lòng làm mới."
  ],
  "VALIDATION_OPERATIONS_21777ACDFF": [
    "单据不存在或已作废。",
    "The document does not exist or is invalid.",
    "Tài liệu không tồn tại hoặc không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_93E7D8BBD1": [
    "仓库调拨请在「业务管理 → 仓库调拨」中撤销。",
    "Please cancel warehouse transfer in \"Business Management → Warehouse Transfer\".",
    "Vui lòng hủy chuyển kho tại phần “Quản lý kinh doanh → Chuyển kho”."
  ],
  "VALIDATION_OPERATIONS_E3F57ACDB3": [
    "期初已结转的演示单据不能作废或退货，请使用数据重置清理。",
    "Demo documents that have been carried forward at the beginning of the period cannot be voided or returned. Please use data reset to clear them.",
    "Các tài liệu demo đã được chuyển tiếp vào đầu kỳ sẽ không bị hủy hoặc trả lại. Vui lòng sử dụng thiết lập lại dữ liệu để xóa chúng."
  ],
  "VALIDATION_OPERATIONS_46CA49EBA3": [
    "此单据已有退货，请先作废关联退货单。",
    "This document has been returned, please cancel the associated return document first.",
    "Tài liệu này đã được trả lại, vui lòng hủy tài liệu trả lại liên quan trước."
  ],
  "VALIDATION_OPERATIONS_9B3DA44D1C": [
    "请先撤销此单据的收付款记录，再作废单据。",
    "Please cancel the receipt and payment record of this document first, and then invalidate the document.",
    "Vui lòng hủy biên bản nhận và thanh toán của chứng từ này trước, sau đó vô hiệu hóa chứng từ này."
  ],
  "VALIDATION_OPERATIONS_55D38E1A60": [
    "此单据不支持采购或销售退货，请作废或另开出入库单。",
    "This document does not support purchase or sales returns, please invalidate it or issue a new delivery/receipt document.",
    "Chứng từ này không hỗ trợ việc mua hoặc trả lại hàng, vui lòng vô hiệu hóa nó hoặc phát hành một chứng từ giao/biên nhận mới."
  ],
  "VALIDATION_OPERATIONS_8FB4967F4F": [
    "请选择退货物料。",
    "Please select a return item.",
    "Vui lòng chọn một mặt hàng trả lại."
  ],
  "VALIDATION_OPERATIONS_506989E80B": [
    "退货数量需为正数且最多 4 位小数，物料不能重复。",
    "The returned quantity must be a positive number with up to 4 decimal places, and the materials cannot be repeated.",
    "Số lượng trả về phải là số dương có tối đa 4 chữ số thập phân và vật tư không được lặp lại."
  ],
  "VALIDATION_OPERATIONS_707EF5C77C": [
    "退货物料不在原单中。",
    "The returned items are not in the original order.",
    "Các mặt hàng trả lại không theo thứ tự ban đầu."
  ],
  "VALIDATION_OPERATIONS_E9EEA5B6A0": [
    "{p0} 退货数量超过可退数量 {p1}。",
    "The returned quantity {p0} exceeds the returnable quantity {p1}.",
    "Số lượng trả lại {p0} vượt quá số lượng có thể trả lại {p1}."
  ],
  "VALIDATION_OPERATIONS_8F261FF6A8": [
    "历史退货金额已超过原单，请先核对并作废错误退货单。",
    "The historical return amount has exceeded the original order. Please check and void the incorrect return order first.",
    "Số tiền hoàn trả lịch sử đã vượt quá đơn đặt hàng ban đầu. Vui lòng kiểm tra và hủy đơn hàng trả lại không chính xác trước."
  ],
  "VALIDATION_OPERATIONS_DC0220B2D1": [
    "退货金额过大。",
    "The return amount is too large.",
    "Số tiền hoàn lại quá lớn."
  ],
  "VALIDATION_OPERATIONS_E35163168C": [
    "每次盘点请选择 1–1000 种物料。",
    "Please select 1–1000 materials for each inventory.",
    "Vui lòng chọn 1–1000 nguyên liệu cho mỗi kho."
  ],
  "VALIDATION_OPERATIONS_C3D4153281": [
    "实盘数量需为非负数且最多 4 位小数，物料不能重复。",
    "The actual quantity must be a non-negative number with up to 4 decimal places, and materials cannot be repeated.",
    "Số lượng thực tế phải là số không âm có tối đa 4 chữ số thập phân và vật liệu không được lặp lại."
  ],
  "VALIDATION_OPERATIONS_39E61FA26F": [
    "物料不属于当前仓库。",
    "The material does not belong to the current warehouse.",
    "Vật liệu không thuộc về kho hiện tại."
  ],
  "VALIDATION_OPERATIONS_B91B3264F2": [
    "{p0} 库存已变化，请刷新后重新盘点。",
    "{p0} inventory has changed, please refresh and take inventory again.",
    "Kho {p0} đã thay đổi, vui lòng làm mới và lấy lại kho."
  ],
  "VALIDATION_OPERATIONS_F91D0AD53A": [
    "请填写有效的物料和减少数量（正数，最多 4 位小数）。",
    "Please fill in a valid material and reduction quantity (positive number, up to 4 decimal places).",
    "Vui lòng điền nguyên liệu hợp lệ và số lượng giảm (số dương, tối đa 4 chữ số thập phân)."
  ],
  "VALIDATION_OPERATIONS_6BC7595D33": [
    "{p0} 库存已变化，请刷新后重试。",
    "{p0} inventory has changed, please refresh and try again.",
    "Khoảng không quảng cáo {p0} đã thay đổi, vui lòng làm mới và thử lại."
  ],
  "VALIDATION_OPERATIONS_0E165EB739": [
    "减少数量不能超过现有库存 {p0}。",
    "Reductions cannot exceed existing inventory {p0}.",
    "Mức giảm không thể vượt quá hàng tồn kho {p0} hiện có."
  ],
  "VALIDATION_OPERATIONS_A704253095": [
    "减少数量需大于 0。",
    "The reduction amount needs to be greater than 0.",
    "Số tiền giảm cần phải lớn hơn 0."
  ],
  "VALIDATION_OPERATIONS_FAE58D5EC8": [
    "请填写有效的物料、增加数量（正数，最多 4 位小数）及当前库存。",
    "Please fill in the valid material, additional quantity (positive number, up to 4 decimal places) and current inventory.",
    "Vui lòng điền vào vật tư hợp lệ, số lượng bổ sung (số dương, tối đa 4 chữ số thập phân) và hàng tồn kho hiện tại."
  ],
  "VALIDATION_OPERATIONS_B2C541A22B": [
    "增加后库存超出上限。",
    "After the increase, the inventory exceeds the upper limit.",
    "Sau khi tăng, hàng tồn kho vượt quá giới hạn trên."
  ],
  "VALIDATION_OPERATIONS_4610C21935": [
    "每次导入 1–1000 行物料。",
    "Import 1–1000 rows of items at a time.",
    "Nhập 1–1000 hàng mục cùng một lúc."
  ],
  "VALIDATION_OPERATIONS_DE658897F6": [
    "期初库存需为非负数且最多 4 位小数。",
    "Opening inventory needs to be non-negative with up to 4 decimal places.",
    "Khoảng không quảng cáo mở đầu cần phải không âm với tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_OPERATIONS_D38FB8BA41": [
    "条码重复或已存在，不会覆盖已有物料。",
    "The barcode is duplicated or already exists and will not overwrite existing materials.",
    "Mã vạch bị trùng lặp hoặc đã tồn tại và sẽ không ghi đè lên các vật tư hiện có."
  ],
  "VALIDATION_OPERATIONS_5E4F1F1DF6": [
    "导入内容已变化，请重新预览。",
    "The imported content has changed, please preview again.",
    "Nội dung đã nhập đã thay đổi, vui lòng xem lại."
  ],
  "VALIDATION_OPERATIONS_7943723734": [
    "第 {p0} 行：{p1}",
    "Line {p0}: {p1}",
    "Dòng {p0}: {p1}"
  ],
  "VALIDATION_OPERATIONS_B6460A9770": [
    "不是支持的 77 ERP 业务备份文件。",
    "Not a supported 77 ERP business backup file.",
    "Không phải là tệp sao lưu doanh nghiệp 77 ERP được hỗ trợ."
  ],
  "VALIDATION_OPERATIONS_125D8ADA24": [
    "备份生产班组无效。",
    "The backup production team is invalid.",
    "Nhóm sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_B5D1D01D7B": [
    "备份生产登记人无效。",
    "The backup production registrant is invalid.",
    "Người đăng ký sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_B2709A9760": [
    "备份操作人信息无效。",
    "The backup operator information is invalid.",
    "Thông tin nhà điều hành sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_AD19192D1B": [
    "备份中的 {p0} 格式或数量无效。",
    "The {p0} format or quantity in the backup is invalid.",
    "Định dạng hoặc số lượng {p0} trong bản sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_FC3A57146D": [
    "备份中的 {p0} 字段或编号无效。",
    "The {p0} field or number in the backup is invalid.",
    "Trường hoặc số {p0} trong bản sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_C2DE2CFCCA": [
    "备份仓库信息无效。",
    "The backup warehouse information is invalid.",
    "Thông tin kho dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_D0F43A39F1": [
    "备份仓库关联无效。",
    "The backup warehouse association is invalid.",
    "Liên kết kho dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_01813C7F37": [
    "备份分类迁移后的数量过多。",
    "The number of backup categories after migration is too high.",
    "Số lượng danh mục sao lưu sau khi di chuyển quá cao."
  ],
  "VALIDATION_OPERATIONS_896081575F": [
    "备份分类迁移后的编号无效。",
    "The number after migration of the backup category is invalid.",
    "Số sau khi di chuyển danh mục sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_0F06A0FE2C": [
    "备份分类仓库关联无效。",
    "The backup category warehouse association is invalid.",
    "Liên kết kho danh mục dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_95C5E44B58": [
    "备份物料同步关联无效。",
    "The backup material synchronization association is invalid.",
    "Liên kết đồng bộ hóa vật tư sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_538BF28A8C": [
    "备份往来单位无效。",
    "The backup correspondent unit is invalid.",
    "Đơn vị tương ứng dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_F9583807F8": [
    "备份往来单位重复。",
    "The backup transaction unit is duplicated.",
    "Đơn vị giao dịch dự phòng bị trùng lặp."
  ],
  "VALIDATION_OPERATIONS_86DA31095A": [
    "备份物料生产类型无效。",
    "The backup material production type is invalid.",
    "Loại sản xuất vật liệu dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_9181664231": [
    "备份客户料号格式无效。",
    "The backup customer material number format is invalid.",
    "Định dạng số tài liệu của khách hàng dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_09E97E8033": [
    "备份上次校验日期无效。",
    "The backup last verification date is invalid.",
    "Ngày xác minh cuối cùng của bản sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_227CBC23F4": [
    "备份物料版本无效。",
    "The backup material version is invalid.",
    "Phiên bản vật tư sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_FBFC9E3443": [
    "备份物料取整属性无效。",
    "The backup material rounding attribute is invalid.",
    "Thuộc tính làm tròn vật liệu dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_9DA40AF2DA": [
    "备份物料使用状态无效。",
    "The backup material usage status is invalid.",
    "Trạng thái sử dụng vật tư dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_22EE90552E": [
    "备份物料分类关联无效。",
    "The backup material classification association is invalid.",
    "Liên kết phân loại vật liệu sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_0565A8304D": [
    "备份物料库存或条码无效。",
    "The backup material inventory or barcode is invalid.",
    "Hàng tồn kho hoặc mã vạch dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_18601BB277": [
    "备份单据内容无效。",
    "The content of the backup document is invalid.",
    "Nội dung của tài liệu sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_96C7089E5E": [
    "备份内部流转类型或收付款设置无效。",
    "The backup internal transfer type or payment settings are invalid.",
    "Loại chuyển khoản nội bộ dự phòng hoặc cài đặt thanh toán không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_6509191AFA": [
    "备份调拨单据无效。",
    "The backup transfer document is invalid.",
    "Tài liệu chuyển nhượng dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_1FDBE46DF3": [
    "备份调拨关联无效。",
    "The backup transfer association is invalid.",
    "Liên kết chuyển dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_CB93D6B3A0": [
    "备份退货关联无效。",
    "Backup returns association is invalid.",
    "Liên kết trả về bản sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_2EB63DE0B1": [
    "备份原单关联无效。",
    "The original backup order association is invalid.",
    "Liên kết đơn hàng dự phòng ban đầu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_DC255AA8AA": [
    "备份调拨单据不完整。",
    "The backup transfer document is incomplete.",
    "Tài liệu chuyển nhượng dự phòng không đầy đủ."
  ],
  "VALIDATION_OPERATIONS_58607DE176": [
    "备份调拨明细不一致。",
    "Backup allocation details are inconsistent.",
    "Chi tiết phân bổ dự phòng không nhất quán."
  ],
  "VALIDATION_OPERATIONS_9B7DB474E1": [
    "备份单据明细无效。",
    "The backup document details are invalid.",
    "Chi tiết tài liệu sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_21FFA47DA0": [
    "备份原单明细金额无效。",
    "The backup original order detail amount is invalid.",
    "Số lượng chi tiết đơn hàng ban đầu dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_FA1A600859": [
    "备份单据合计与明细不一致。",
    "The backup document total and details are inconsistent.",
    "Tổng số tài liệu sao lưu và chi tiết không nhất quán."
  ],
  "VALIDATION_OPERATIONS_9D4E055C5D": [
    "备份退货明细与原单不一致。",
    "The backup return details are inconsistent with the original order.",
    "Chi tiết trả lại dự phòng không nhất quán với đơn hàng ban đầu."
  ],
  "VALIDATION_OPERATIONS_D17778F413": [
    "备份退货金额超过原单。",
    "The backup return amount exceeds the original order.",
    "Số tiền trả lại dự phòng vượt quá đơn hàng ban đầu."
  ],
  "VALIDATION_OPERATIONS_AA46D0B402": [
    "备份退货数量超过原单。",
    "The backup return quantity exceeds the original order.",
    "Số lượng trả lại dự phòng vượt quá đơn hàng ban đầu."
  ],
  "VALIDATION_OPERATIONS_57D741C4F8": [
    "备份盘点记录无效。",
    "The backup inventory record is invalid.",
    "Bản ghi hàng tồn kho dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_777F897945": [
    "备份物料改价记录无效。",
    "The backup material price change record is invalid.",
    "Bản ghi thay đổi giá vật liệu dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_A491667320": [
    "备份收付款无效。",
    "The backup payment is invalid.",
    "Khoản thanh toán dự phòng không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_DB13E8FE7D": [
    "备份收付款超过单据金额。",
    "The backup payment exceeds the document amount.",
    "Khoản thanh toán dự phòng vượt quá số tiền chứng từ."
  ],
  "VALIDATION_OPERATIONS_82A81BC77F": [
    "备份模板无效。",
    "The backup template is invalid.",
    "Mẫu sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_2D95F1B2CE": [
    "备份模板明细无效。",
    "The backup template details are invalid.",
    "Chi tiết mẫu sao lưu không hợp lệ."
  ],
  "VALIDATION_OPERATIONS_DB82CE5006": [
    "请先预览并确认恢复备份。",
    "Please preview and confirm the restored backup first.",
    "Vui lòng xem trước và xác nhận bản sao lưu được khôi phục trước."
  ],
  "VALIDATION_OPERATIONS_B70AA436D2": [
    "业务数据已变化，请重新预览后恢复。",
    "Business data has changed, please preview again and restore.",
    "Dữ liệu doanh nghiệp đã thay đổi, vui lòng xem trước và khôi phục."
  ],
  "VALIDATION_ORDERS_299364946F": [
    "物料数量必须为正数且最多 4 位小数，单价最多四位小数且不能为负数。",
    "The material quantity must be a positive number with up to 4 decimal places, and the unit price must be a positive number with up to 4 decimal places and cannot be negative.",
    "Số lượng vật tư phải là số dương tối đa 4 chữ số thập phân, đơn giá phải là số dương tối đa 4 chữ số thập phân và không được âm."
  ],
  "VALIDATION_ORDERS_055CA8F72A": [
    "同一物料不能重复添加，请合并数量。",
    "The same material cannot be added repeatedly, please combine the quantities.",
    "Không thể thêm cùng một vật liệu nhiều lần, vui lòng kết hợp số lượng."
  ],
  "VALIDATION_ORDERS_9DA16A668B": [
    "{p0} 库存不足（当前 {p1} {p2}）。",
    "{p0} is out of stock (currently {p1} {p2}).",
    "{p0} đã hết hàng (hiện tại là {p1} {p2})."
  ],
  "VALIDATION_ORDERS_181DA86F73": [
    "{p0} 入库后库存超出上限。",
    "{p0} The inventory exceeds the upper limit after storage.",
    "{p0} Hàng tồn kho vượt quá giới hạn trên sau khi lưu trữ."
  ],
  "VALIDATION_ORDERS_08E8432179": [
    "物料金额过大，请减少数量。",
    "The amount of material is too large, please reduce the quantity.",
    "Số lượng vật liệu quá lớn, vui lòng giảm số lượng."
  ],
  "VALIDATION_ORDERS_65D93AA1DF": [
    "单据金额过大，请减少数量或拆分单据。",
    "The document amount is too large, please reduce the quantity or split the document.",
    "Số lượng tài liệu quá lớn, vui lòng giảm số lượng hoặc chia nhỏ tài liệu."
  ],
  "VALIDATION_POSITIONS_5B6FFF125D": [
    "请选择有效且不重复的业务权限。",
    "Please select valid and non-duplicate business permissions.",
    "Vui lòng chọn quyền kinh doanh hợp lệ và không trùng lặp."
  ],
  "VALIDATION_POSITIONS_916376B088": [
    "员工 {p0} 的原权限数据无效，岗位迁移已回滚，请修复原权限后重试。",
    "The original permission data of employee {p0} is invalid and the job migration has been rolled back. Please repair the original permissions and try again.",
    "Dữ liệu quyền ban đầu của nhân viên {p0} không hợp lệ và quá trình di chuyển công việc đã bị khôi phục. Vui lòng sửa lại các quyền ban đầu và thử lại."
  ],
  "VALIDATION_POSITIONS_D117010A36": [
    "员工 {p0} 的迁移权限核对失败，岗位迁移已回滚。",
    "The migration permission verification of employee {p0} failed and the job migration has been rolled back.",
    "Việc xác minh quyền di chuyển của nhân viên {p0} không thành công và quá trình di chuyển công việc đã bị khôi phục."
  ],
  "VALIDATION_POSITIONS_A125437558": [
    "请为员工选择有效岗位。",
    "Please select a valid position for the employee.",
    "Vui lòng chọn một vị trí hợp lệ cho nhân viên."
  ],
  "VALIDATION_POSITIONS_F837D2AC51": [
    "所选岗位不存在，请刷新后重新选择。",
    "The selected position does not exist, please refresh and select again.",
    "Vị trí đã chọn không tồn tại, vui lòng làm mới và chọn lại."
  ],
  "VALIDATION_POSITIONS_5CA08F5739": [
    "仅管理员可以配置岗位。",
    "Only administrators can configure positions.",
    "Chỉ quản trị viên mới có thể định cấu hình vị trí."
  ],
  "VALIDATION_POSITIONS_8037F6E974": [
    "岗位名称已存在。",
    "The position name already exists.",
    "Tên vị trí đã tồn tại."
  ],
  "VALIDATION_POSITIONS_B4E7A9A7EA": [
    "岗位编号无效。",
    "The position number is invalid.",
    "Số vị trí không hợp lệ."
  ],
  "VALIDATION_POSITIONS_DDFF7B695F": [
    "岗位不存在，请刷新列表。",
    "The position does not exist, please refresh the list.",
    "Vị trí không tồn tại, vui lòng làm mới danh sách."
  ],
  "VALIDATION_POSITIONS_7FEC8B0876": [
    "岗位配置已被修改，请重新打开后核对。",
    "The position configuration has been modified, please reopen it and check.",
    "Cấu hình vị trí đã được sửa đổi, vui lòng mở lại và kiểm tra."
  ],
  "VALIDATION_POSITIONS_0A1D20B257": [
    "请填写 1–60 字的岗位名称和最多 200 字的说明。",
    "Please provide a job title of 1–60 words and a description of up to 200 words.",
    "Vui lòng cung cấp chức danh công việc từ 1–60 từ và mô tả tối đa 200 từ."
  ],
  "VALIDATION_POSITIONS_A5925CFD34": [
    "请选择有效的岗位访问模式。",
    "Please select a valid post access mode.",
    "Vui lòng chọn chế độ truy cập bài đăng hợp lệ."
  ],
  "VALIDATION_POSITIONS_42F0D69FC1": [
    "仅生产作业岗位只能配置本组生产登记权限。",
    "Only production job positions can only be configured with production registration permissions for this group.",
    "Chỉ có thể cấu hình các vị trí công việc sản xuất với quyền đăng ký sản xuất cho nhóm này."
  ],
  "VALIDATION_POSITIONS_6AF6DBA00E": [
    "新岗位只能使用标准模块权限。",
    "New positions can only use standard module permissions.",
    "Vị trí mới chỉ có thể sử dụng quyền mô-đun tiêu chuẩn."
  ],
  "VALIDATION_POSITIONS_027B681A19": [
    "请明确确认是否切换旧版权限。",
    "Please confirm clearly whether to switch to the old version permissions.",
    "Vui lòng xác nhận rõ ràng xem có nên chuyển sang quyền của phiên bản cũ hay không."
  ],
  "VALIDATION_POSITIONS_88508A1C48": [
    "不能直接修改旧版兼容标记，请使用切换权限操作。",
    "The old version compatibility mark cannot be modified directly, please use the switch permission operation.",
    "Dấu tương thích phiên bản cũ không thể được sửa đổi trực tiếp, vui lòng sử dụng thao tác cấp phép chuyển đổi."
  ],
  "VALIDATION_POSITIONS_D5BF17989A": [
    "此岗位仍沿用旧版权限，请确认切换为标准模块权限后保存。",
    "This post still uses the old version of permissions. Please confirm to switch to standard module permissions and save.",
    "Bài đăng này vẫn sử dụng phiên bản quyền cũ. Vui lòng xác nhận để chuyển sang quyền mô-đun tiêu chuẩn và lưu."
  ],
  "VALIDATION_POSITIONS_9251355BD1": [
    "岗位仍有关联员工（包括停用账号），请先调整员工岗位。",
    "There are still employees associated with the position (including deactivated accounts), please adjust the employee positions first.",
    "Vẫn còn nhân viên được liên kết với vị trí (bao gồm cả tài khoản đã bị vô hiệu hóa), vui lòng điều chỉnh vị trí nhân viên trước."
  ],
  "VALIDATION_POSITIONS_5F3BEC438A": [
    "管理员拥有全部权限，无需分配岗位。",
    "Administrators have full permissions and do not need to assign positions.",
    "Quản trị viên có toàn quyền và không cần phân công chức vụ."
  ],
  "VALIDATION_POSITIONS_DD15E37C24": [
    "员工岗位或权限已变化，请刷新后重新选择。",
    "Employee positions or permissions have changed, please refresh and select again.",
    "Vị trí hoặc quyền của nhân viên đã thay đổi, vui lòng làm mới và chọn lại."
  ],
  "VALIDATION_PRODUCT_HISTORY_AAF887F466": [
    "记录分页参数无效。",
    "The record paging parameter is invalid.",
    "Tham số phân trang bản ghi không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_ACCESS_896064E10E": [
    "需要生产管理或生产登记权限。",
    "Production management or production registration permissions are required.",
    "Cần có quyền quản lý sản xuất hoặc đăng ký sản xuất."
  ],
  "VALIDATION_PRODUCTION_ACCESS_A2CE0B4227": [
    "生产单不存在或不属于当前生产组。",
    "The production order does not exist or does not belong to the current production group.",
    "Lệnh sản xuất không tồn tại hoặc không thuộc nhóm sản xuất hiện tại."
  ],
  "VALIDATION_PRODUCTION_GROUPS_76BD40115B": [
    "请选择有效生产组，或选择不属于生产组。",
    "Please select a valid production group, or select Not a member of a production group.",
    "Vui lòng chọn nhóm sản xuất hợp lệ hoặc chọn Không phải là thành viên của nhóm sản xuất."
  ],
  "VALIDATION_PRODUCTION_GROUPS_AE35EE1F3F": [
    "生产组不存在，请刷新后重新选择。",
    "The production group does not exist, please refresh and select again.",
    "Nhóm sản xuất không tồn tại, vui lòng làm mới và chọn lại."
  ],
  "VALIDATION_PRODUCTION_GROUPS_B4077EB386": [
    "没有生产组配置权限。",
    "There is no production group configuration permission.",
    "Không có quyền cấu hình nhóm sản xuất."
  ],
  "VALIDATION_PRODUCTION_GROUPS_2BEFCED0B8": [
    "生产组名称已存在。",
    "The production group name already exists.",
    "Tên nhóm sản xuất đã tồn tại."
  ],
  "VALIDATION_PRODUCTION_GROUPS_2ABDFABEDD": [
    "请填写 1–60 字的生产组名称和最多 200 字的说明。",
    "Please provide a production group name of 1–60 words and a description of up to 200 words.",
    "Vui lòng cung cấp tên nhóm sản xuất từ 1–60 từ và mô tả tối đa 200 từ."
  ],
  "VALIDATION_PRODUCTION_GROUPS_282C7D9DCC": [
    "生产组编号无效。",
    "The production group number is invalid.",
    "Số nhóm sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_GROUPS_09A2CD8BE7": [
    "生产组不存在。",
    "The production group does not exist.",
    "Nhóm sản xuất không tồn tại."
  ],
  "VALIDATION_PRODUCTION_GROUPS_FAF7B047BF": [
    "生产组已被修改，请刷新后重试。",
    "The production group has been modified, please refresh and try again.",
    "Nhóm sản xuất đã được sửa đổi, vui lòng làm mới và thử lại."
  ],
  "VALIDATION_PRODUCTION_GROUPS_D90AB76516": [
    "生产组仍有关联员工或生产单，不能删除。",
    "The production group still has associated employees or production orders and cannot be deleted.",
    "Nhóm sản xuất vẫn còn nhân viên hoặc lệnh sản xuất liên quan và không thể xóa được."
  ],
  "VALIDATION_PRODUCTION_GROUPS_B8696C92DF": [
    "管理员无需分配生产组。",
    "Administrators do not need to assign production groups.",
    "Quản trị viên không cần chỉ định nhóm sản xuất."
  ],
  "VALIDATION_PRODUCTION_GROUPS_DC1C91FC95": [
    "员工岗位或生产组已变化，请刷新后重试。",
    "The employee position or production group has changed, please refresh and try again.",
    "Vị trí nhân viên hoặc nhóm sản xuất đã thay đổi, vui lòng làm mới và thử lại."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_5DCC3A3BC9": [
    "生产材料单不存在或不属于当前仓库。",
    "The production bill of material does not exist or does not belong to the current warehouse.",
    "Phiếu sản xuất nguyên vật liệu không tồn tại hoặc không thuộc kho hiện tại."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_075189E3EF": [
    "{p0}材料余额成本不足或超出范围。",
    "The remaining material cost for {p0} is insufficient or out of range.",
    "Giá trị vật tư còn lại của {p0} không đủ hoặc vượt phạm vi cho phép."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_072D3B24BC": [
    "请先确认或取消待批准的生产材料单。",
    "Please confirm or cancel the pending production material order first.",
    "Trước tiên, vui lòng xác nhận hoặc hủy đơn đặt hàng nguyên liệu sản xuất đang chờ xử lý."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_7F279BE87F": [
    "仅新流程待生产单可以开始生产。",
    "Only new process to-be-produced orders can start production.",
    "Chỉ những đơn hàng mới được sản xuất mới có thể bắt đầu sản xuất."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_1AC5B7FD91": [
    "仅生产中的单据可补料，生产中或已完成单据可退料。",
    "Only documents in production can be replenished, and documents in production or completed can be returned.",
    "Chỉ những tài liệu đang trong quá trình sản xuất mới có thể được bổ sung và những tài liệu đang trong quá trình sản xuất hoặc đã hoàn thành mới có thể được trả lại."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_CC609DDD6C": [
    "请核对补料或退料方向及材料明细，材料不能重复。",
    "Please check the direction of replenishing or returning materials and the material details. Materials cannot be repeated.",
    "Vui lòng kiểm tra hướng bổ sung hoặc trả lại vật tư và các chi tiết vật tư. Vật liệu không thể được lặp lại."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_5460037763": [
    "申请备注最多 500 字。",
    "Application notes can be up to 500 words.",
    "Ghi chú ứng dụng có thể lên tới 500 từ."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_9648114B9F": [
    "材料需属于本生产单，申请数量需为正数且最多 4 位小数。",
    "The materials need to belong to this production order, and the requested quantity needs to be a positive number with up to 4 decimal places.",
    "Nguyên liệu cần thuộc đơn hàng sản xuất này và số lượng yêu cầu phải là số dương có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_72D52E7743": [
    "{p0}退料超过已领未耗余额。",
    "The return quantity for {p0} exceeds the issued, unconsumed balance.",
    "Số lượng trả lại của {p0} vượt số dư đã lĩnh nhưng chưa tiêu hao."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_FBFC870131": [
    "生产材料单筛选或分页参数无效。",
    "The production material list filtering or paging parameters are invalid.",
    "Các thông số phân trang hoặc lọc danh sách vật liệu sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_3739B429AD": [
    "无此方向的仓库权限。",
    "There is no warehouse permission in this direction.",
    "Không có sự cho phép kho hàng theo hướng này."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_EE351CA53B": [
    "生产材料单编号无效。",
    "The production material bill number is invalid.",
    "Số hóa đơn nguyên liệu sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_721BBC979D": [
    "材料单已变化，请刷新后核对。",
    "The material list has changed, please refresh and check.",
    "Danh sách vật liệu đã thay đổi, vui lòng làm mới và kiểm tra."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_6E3E88E6B1": [
    "请填写取消原因（最多 500 字）。",
    "Please enter the reason for cancellation (maximum 500 words).",
    "Vui lòng nhập lý do hủy (tối đa 500 từ)."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_84BD0263D2": [
    "生产单状态不允许确认此材料单。",
    "The production order status does not allow confirmation of this material order.",
    "Trạng thái đơn hàng sản xuất không cho phép xác nhận đơn hàng nguyên vật liệu này."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_C2932BE624": [
    "{p0}单位或取整规则已变化，请取消后重新核对。",
    "The {p0} unit or rounding rules have changed, please cancel and recheck.",
    "Đơn vị {p0} hoặc quy tắc làm tròn đã thay đổi, vui lòng hủy và kiểm tra lại."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_69A0924DC2": [
    "{p0}已停用，请先核对物料。",
    "{p0} is disabled. Check the material first.",
    "{p0} đã ngừng sử dụng. Vui lòng kiểm tra vật tư trước."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_2D1414892F": [
    "{p0}库存不足，无法整单出库。",
    "Insufficient stock for {p0}; the complete material issue cannot be confirmed.",
    "Không đủ tồn kho cho {p0}; không thể xác nhận xuất toàn bộ vật tư của lệnh."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_258E764631": [
    "{p0}累计领料或材料余额超出数量上限。",
    "The cumulative issued quantity or remaining material balance for {p0} exceeds the quantity limit.",
    "Tổng lượng đã lĩnh hoặc số dư vật tư của {p0} vượt giới hạn số lượng."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_35FA35800F": [
    "{p0}退料超过当前已领未耗余额，请取消后重新申请。",
    "The return quantity for {p0} exceeds the current issued, unconsumed balance. Cancel and submit a new request.",
    "Số lượng trả lại của {p0} vượt số dư hiện tại đã lĩnh nhưng chưa tiêu hao. Vui lòng hủy và gửi lại yêu cầu."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_DFA13DBBA3": [
    "{p0}材料余额成本超出范围。",
    "The remaining material cost for {p0} is out of range.",
    "Giá trị vật tư còn lại của {p0} vượt phạm vi cho phép."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_080067B1C5": [
    "材料成本超出范围。",
    "Material costs are out of range.",
    "Chi phí vật liệu nằm ngoài phạm vi."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_BEDF58CC39": [
    "备份生产材料单状态或关联无效。",
    "The backup production bill of material status or association is invalid.",
    "Hóa đơn sản xuất dự phòng về tình trạng nguyên vật liệu hoặc liên kết không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_BE0735F0C8": [
    "备份生产材料单明细无效。",
    "The backup production material bill details are invalid.",
    "Chi tiết hóa đơn nguyên vật liệu sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_95DBED0EAD": [
    "备份生产材料单成本合计无效。",
    "The backup production BOM cost total is invalid.",
    "Tổng chi phí BOM sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_855914D6CF": [
    "备份生产领料阶段无效。",
    "The backup production picking phase is invalid.",
    "Giai đoạn chọn sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_C5E651B79A": [
    "备份生产领料阶段与材料单不一致。",
    "The backup production picking stage is inconsistent with the material list.",
    "Giai đoạn chọn sản xuất dự phòng không nhất quán với danh mục nguyên liệu."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_190DCE69E2": [
    "备份首次领料数量与整单计划不一致。",
    "The backup first picking quantity is inconsistent with the entire order plan.",
    "Số lượng lấy hàng đầu tiên dự phòng không nhất quán với toàn bộ kế hoạch đặt hàng."
  ],
  "VALIDATION_PRODUCTION_MATERIALS_9C798C7CAE": [
    "备份生产材料余额或成本无效。",
    "The backup production material balance or cost is not valid.",
    "Số dư hoặc chi phí nguyên vật liệu sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_461F0B3A14": [
    "生产入库单不存在或不属于当前仓库。",
    "The production receipt document does not exist or does not belong to the current warehouse.",
    "Chứng từ biên nhận sản xuất không tồn tại hoặc không thuộc kho hiện tại."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_FA736D7800": [
    "已入库批次作废还需要仓库入库权限。",
    "Warehouse warehousing permission is also required to invalidate a batch that has been put into storage.",
    "Giấy phép lưu kho cũng được yêu cầu để vô hiệu hóa một lô đã được đưa vào kho."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_2A04CB88DA": [
    "需要仓库入库权限。",
    "Warehouse warehousing permission is required.",
    "Cần phải có giấy phép lưu kho."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_9EAC891215": [
    "生产入库单筛选或分页参数无效。",
    "The filtering or paging parameters of the production receipt order are invalid.",
    "Các tham số lọc hoặc phân trang của đơn hàng biên nhận sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_C19E6C5183": [
    "生产入库单编号无效。",
    "The production receipt order number is invalid.",
    "Số thứ tự biên nhận sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_82E44D08F0": [
    "生产入库单已变化，请刷新后核对。",
    "The production receipt order has changed, please refresh and check.",
    "Lệnh biên nhận sản xuất đã thay đổi, vui lòng làm mới và kiểm tra."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_695C41BBED": [
    "生产批次状态不允许批准入库。",
    "The production batch status does not allow approval for storage.",
    "Trạng thái lô sản xuất không cho phép phê duyệt lưu trữ."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_7D6F2CE685": [
    "{p0}物料不存在或仓库已变化。",
    "The {p0} material does not exist or the warehouse has changed.",
    "Vật liệu {p0} không tồn tại hoặc kho đã thay đổi."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_BC3E4645A5": [
    "{p0}单位或取整规则已变化，请先核对。",
    "The {p0} unit or rounding rules have changed, please check first.",
    "Đơn vị {p0} hoặc quy tắc làm tròn đã thay đổi, vui lòng kiểm tra trước."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_389B27A21D": [
    "备份生产入库单状态、快照或批次关联无效。",
    "The backup of production receipt order status, snapshot or batch association is invalid.",
    "Bản sao lưu trạng thái đơn hàng biên nhận sản xuất, ảnh chụp nhanh hoặc liên kết lô không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_41944CA186": [
    "备份生产入库单明细快照无效。",
    "The backup snapshot of production receipt order details is invalid.",
    "Ảnh chụp nhanh dự phòng chi tiết đơn hàng biên nhận sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_C42D632333": [
    "备份生产批次入库标记或单据缺失。",
    "The backup production batch warehousing mark or document is missing.",
    "Thiếu dấu hoặc tài liệu lưu kho lô sản xuất dự phòng."
  ],
  "VALIDATION_PRODUCTION_RECEIPTS_DB79A95837": [
    "备份生产入库单缺少成品或废料明细。",
    "The backup production receipt document lacks finished product or scrap details.",
    "Chứng từ biên nhận sản xuất dự phòng thiếu chi tiết thành phẩm hoặc phế liệu."
  ],
  "VALIDATION_PRODUCTION_STAGES_FB2F350EC2": [
    "半成品组成成本分配不守恒。",
    "The component cost allocation of semi-finished products is not conserved.",
    "Việc phân bổ chi phí thành phần bán thành phẩm không được bảo toàn."
  ],
  "VALIDATION_PRODUCTION_STAGES_144F942940": [
    "分层生产累计成本超出范围。",
    "Cumulative cost of layered production is out of range.",
    "Chi phí tích lũy của sản xuất theo lớp nằm ngoài phạm vi."
  ],
  "VALIDATION_PRODUCTION_STAGES_20FD350DD7": [
    "仍有本单半成品余额：{p0}。请按实际情况继续登记。",
    "This order still has an intermediate product balance: {p0}. Continue recording actual production.",
    "Lệnh này vẫn còn số dư bán thành phẩm: {p0}. Vui lòng tiếp tục ghi nhận theo sản xuất thực tế."
  ],
  "VALIDATION_PRODUCTION_STAGES_79F01689A3": [
    "此单使用原有生产流程。",
    "This order uses the original production process.",
    "Đơn hàng này sử dụng quy trình sản xuất ban đầu."
  ],
  "VALIDATION_PRODUCTION_STAGES_EF6CB506AB": [
    "层级批次不存在或不属于此生产单。",
    "The hierarchical batch does not exist or does not belong to this production order.",
    "Lô phân cấp không tồn tại hoặc không thuộc đơn hàng sản xuất này."
  ],
  "VALIDATION_PRODUCTION_STAGES_D9E92CCA1E": [
    "仅未开始、无作业记录的多层材料流程草稿可以启用分层。",
    "Layering can be enabled only for drafts of multi-layer material flows that have not been started and have no job records.",
    "Bạn chỉ có thể bật tính năng phân lớp cho bản nháp của các luồng vật liệu nhiều lớp chưa được bắt đầu và không có bản ghi công việc."
  ],
  "VALIDATION_PRODUCTION_STAGES_A4F1B8154B": [
    "生产层不存在。",
    "The production layer does not exist.",
    "Lớp sản xuất không tồn tại."
  ],
  "VALIDATION_PRODUCTION_STAGES_ECAEA57547": [
    "批次分页参数无效。",
    "The batch paging parameter is invalid.",
    "Tham số phân trang hàng loạt không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_STAGES_68168F538D": [
    "请先开始生产并由仓库批准领料后登记。",
    "Please start production first and get approval from the warehouse before registering.",
    "Vui lòng bắt đầu sản xuất trước và nhận được sự chấp thuận của kho trước khi đăng ký."
  ],
  "VALIDATION_PRODUCTION_STAGES_24E676E33F": [
    "请核对本批产量、备注及继续生产选项。",
    "Please check the production volume, remarks and continued production options of this batch.",
    "Vui lòng kiểm tra khối lượng sản xuất, nhận xét và các phương án sản xuất tiếp theo của đợt này."
  ],
  "VALIDATION_PRODUCTION_STAGES_C4550AC722": [
    "半成品层只能登记继续，不登记废料或结束整单。",
    "The semi-finished product layer can only be registered for continuation and does not register scrap or end the entire order.",
    "Lớp bán thành phẩm chỉ được đăng ký để tiếp tục và không được đăng ký phế liệu hoặc kết thúc toàn bộ đơn hàng."
  ],
  "VALIDATION_PRODUCTION_STAGES_573B51C374": [
    "请核对全部直属投入，路径不能重复或增删。",
    "Please check all direct inputs. Paths cannot be repeated or added or deleted.",
    "Vui lòng kiểm tra tất cả các đầu vào trực tiếp. Đường dẫn không thể được lặp lại hoặc thêm hoặc xóa."
  ],
  "VALIDATION_PRODUCTION_STAGES_8E97C19472": [
    "直属投入需为有效数量且最多 4 位小数；半成品投入必须大于零。",
    "Direct input must be a valid quantity with up to 4 decimal places; semi-finished product input must be greater than zero.",
    "Dữ liệu nhập trực tiếp phải là số lượng hợp lệ có tối đa 4 chữ số thập phân; đầu vào bán thành phẩm phải lớn hơn 0."
  ],
  "VALIDATION_PRODUCTION_STAGES_2B2C6F1F4F": [
    "{p0}单位或取整规则已变化。",
    "{p0} units or rounding rules have changed.",
    "Đơn vị {p0} hoặc quy tắc làm tròn đã thay đổi."
  ],
  "VALIDATION_PRODUCTION_STAGES_B2F9267B0A": [
    "{p0}已停用。",
    "{p0} has been deactivated.",
    "{p0} đã bị vô hiệu hóa."
  ],
  "VALIDATION_PRODUCTION_STAGES_8593E63FD2": [
    "至少一种直属投入需大于零。",
    "At least one direct input needs to be greater than zero.",
    "Ít nhất một đầu vào trực tiếp cần phải lớn hơn 0."
  ],
  "VALIDATION_PRODUCTION_STAGES_8FE6B9BAA0": [
    "本层产品已停用或单位、取整规则已变化。",
    "Products at this level have been deactivated or the unit and rounding rules have been changed.",
    "Các sản phẩm ở cấp độ này đã bị vô hiệu hóa hoặc đơn vị và quy tắc làm tròn đã được thay đổi."
  ],
  "VALIDATION_PRODUCTION_STAGES_2853D025E9": [
    "层级批次达到上限（每层 1000 批、整单 10000 批，含作废），请拆分生产单。",
    "The level batches have reached the upper limit (1,000 batches for each level, 10,000 batches for the entire order, including invalidation), please split the production order.",
    "Các lô cấp đã đạt đến giới hạn trên (1.000 lô cho mỗi cấp, 10.000 lô cho toàn bộ đơn hàng, bao gồm cả việc vô hiệu), vui lòng chia nhỏ đơn hàng sản xuất."
  ],
  "VALIDATION_PRODUCTION_STAGES_01D507200B": [
    "累计产量超出范围。",
    "Cumulative output is out of range.",
    "Sản lượng tích lũy nằm ngoài phạm vi."
  ],
  "VALIDATION_PRODUCTION_STAGES_FFD5B98197": [
    "原料组成累计超出范围。",
    "The cumulative composition of raw materials is out of range.",
    "Thành phần tích lũy của nguyên liệu thô nằm ngoài phạm vi."
  ],
  "VALIDATION_PRODUCTION_STAGES_70A87BC9EF": [
    "{p0}已领未耗余额不足（当前 {p1} {p2}）。请补料或核对实际投入。",
    "The issued, unconsumed balance for {p0} is insufficient (current: {p1} {p2}). Request additional materials or check the actual input.",
    "Không đủ số dư đã lĩnh nhưng chưa tiêu hao của {p0} (hiện có: {p1} {p2}). Yêu cầu bổ sung vật tư hoặc kiểm tra lượng đưa vào thực tế."
  ],
  "VALIDATION_PRODUCTION_STAGES_357F683CF0": [
    "{p0}来源层［{p1}］半成品余额不足（还缺 {p2} {p3}），请先登记下层生产。",
    "Insufficient intermediate product balance for {p0} at source stage [{p1}] (short by {p2} {p3}). Record production at the lower stage first.",
    "Không đủ số dư bán thành phẩm {p0} tại công đoạn nguồn [{p1}] (thiếu {p2} {p3}). Vui lòng ghi nhận sản xuất ở công đoạn dưới trước."
  ],
  "VALIDATION_PRODUCTION_STAGES_7DDA3681A9": [
    "本批成本超出范围。",
    "The cost of this batch is out of range.",
    "Chi phí của lô này nằm ngoài phạm vi."
  ],
  "VALIDATION_PRODUCTION_STAGES_0B2C871681": [
    "生产单已经作废。",
    "The production order has been invalidated.",
    "Lệnh sản xuất đã bị vô hiệu."
  ],
  "VALIDATION_PRODUCTION_STAGES_309593C52E": [
    "层级批次已经作废。",
    "The hierarchical batch has been invalidated.",
    "Lô phân cấp đã bị vô hiệu."
  ],
  "VALIDATION_PRODUCTION_STAGES_3B3FFB8FBC": [
    "{p0}单位或取整规则已变化，无法按原快照作废。",
    "The unit or rounding rule for {p0} has changed. This batch cannot be voided using the original snapshot.",
    "Đơn vị hoặc quy tắc làm tròn của {p0} đã thay đổi. Không thể hủy lô theo bản chụp ban đầu."
  ],
  "VALIDATION_PRODUCTION_STAGES_6D8372C7C5": [
    "请填写作废原因（最多 500 字）。",
    "Please fill in the reason for cancellation (maximum 500 words).",
    "Vui lòng điền lý do hủy (tối đa 500 từ)."
  ],
  "VALIDATION_PRODUCTION_STAGES_E4D1BD0C9B": [
    "此批次已被上层使用，请先作废上层批次：{p0}。",
    "This batch has been consumed by an upper stage. Void the upper-stage batch first: {p0}.",
    "Lô này đã được công đoạn trên sử dụng. Vui lòng hủy lô ở công đoạn trên trước: {p0}."
  ],
  "VALIDATION_PRODUCTION_STAGES_5C42DA5988": [
    "需要生产管理和单据纠正权限。",
    "Production management and document correction permissions are required.",
    "Cần có quyền quản lý sản xuất và chỉnh sửa tài liệu."
  ],
  "VALIDATION_PRODUCTION_STAGES_6530046FC0": [
    "备份分层记录编号无效或重复。",
    "The backup layer record number is invalid or duplicate.",
    "Số bản ghi lớp sao lưu không hợp lệ hoặc trùng lặp."
  ],
  "VALIDATION_PRODUCTION_STAGES_41D98A89AF": [
    "备份分层流程标志无效。",
    "The backup tiering process flag is invalid.",
    "Cờ quá trình sao lưu tầng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_STAGES_6050C20CED": [
    "旧流程不能包含分层账。",
    "The old process cannot include hierarchical ledgers.",
    "Quy trình cũ không thể bao gồm sổ cái phân cấp."
  ],
  "VALIDATION_PRODUCTION_STAGES_A86746D1CD": [
    "分层生产必须使用材料流程和多层配方快照。",
    "Layered production must use material flow and multi-layer recipe snapshots.",
    "Sản xuất theo lớp phải sử dụng luồng nguyên liệu và ảnh chụp nhanh công thức nhiều lớp."
  ],
  "VALIDATION_PRODUCTION_STAGES_5882CBF207": [
    "备份生产层数量无效。",
    "The number of backup production tiers is invalid.",
    "Số bậc sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_STAGES_43632AD4AC": [
    "备份生产层与快照不一致。",
    "Backing up the production layer is inconsistent with the snapshot.",
    "Sao lưu lớp sản xuất không nhất quán với ảnh chụp nhanh."
  ],
  "VALIDATION_PRODUCTION_STAGES_6F7323A594": [
    "备份生产单层级批次过多。",
    "There are too many single-level batches in backup production.",
    "Có quá nhiều lô cấp đơn trong quá trình sản xuất dự phòng."
  ],
  "VALIDATION_PRODUCTION_STAGES_38F8D6ACDB": [
    "备份根完工批次缺少层级登记。",
    "Backup root completion batch is missing hierarchical registration.",
    "Lô hoàn thành gốc sao lưu bị thiếu đăng ký phân cấp."
  ],
  "VALIDATION_PRODUCTION_STAGES_3D4DEBDCE3": [
    "备份生产层关联无效。",
    "The backup production layer association is invalid.",
    "Liên kết lớp sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_STAGES_3F809042AF": [
    "备份层级批次字段、状态或归属无效。",
    "The backup level batch field, status or ownership is invalid.",
    "Trường, trạng thái hoặc quyền sở hữu của lô cấp độ sao lưu không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_STAGES_65B9A41841": [
    "备份根层与成品批次不一致。",
    "The backup root layer is inconsistent with the finished batch.",
    "Lớp gốc sao lưu không nhất quán với lô đã hoàn thành."
  ],
  "VALIDATION_PRODUCTION_STAGES_172BBE9A95": [
    "半成品批次不能关联仓库成品批次。",
    "Semi-finished product batches cannot be associated with warehouse finished product batches.",
    "Lô bán thành phẩm không thể liên kết với lô thành phẩm trong kho."
  ],
  "VALIDATION_PRODUCTION_STAGES_14B7361C40": [
    "备份直属投入不完整。",
    "Backup direct input is incomplete.",
    "Dữ liệu nhập trực tiếp dự phòng không đầy đủ."
  ],
  "VALIDATION_PRODUCTION_STAGES_73F51C81C8": [
    "备份层级批次投入成本不一致。",
    "The backup level batch input costs are inconsistent.",
    "Chi phí đầu vào hàng loạt mức sao lưu không nhất quán."
  ],
  "VALIDATION_PRODUCTION_STAGES_A5A4730BE1": [
    "备份层级直属投入无效。",
    "Investments directly under the backup level are invalid.",
    "Đầu tư trực tiếp dưới mức dự phòng là không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_STAGES_25BDAE37D3": [
    "备份半成品分配与投入不一致。",
    "The allocation of backup semi-finished products is inconsistent with the input.",
    "Việc phân bổ bán thành phẩm dự phòng chưa phù hợp với đầu vào."
  ],
  "VALIDATION_PRODUCTION_STAGES_4BD169E6E8": [
    "备份半成品来源跨单、层级或状态依赖无效。",
    "The backup semi-finished product source is invalid across orders, levels or status dependencies.",
    "Nguồn bán thành phẩm dự phòng không hợp lệ đối với các đơn hàng, cấp độ hoặc trạng thái phụ thuộc."
  ],
  "VALIDATION_PRODUCTION_STAGES_3761DDAB3D": [
    "备份半成品分配组成成本不一致。",
    "Backup semi-finished product distribution component costs are inconsistent.",
    "Chi phí thành phần phân phối bán thành phẩm dự phòng không nhất quán."
  ],
  "VALIDATION_PRODUCTION_STAGES_26484C4A19": [
    "备份半成品分配原料组成不完整或超额。",
    "Backup semi-finished product distribution raw material composition is incomplete or excessive.",
    "Thành phần nguyên liệu thô phân phối bán thành phẩm dự phòng không đầy đủ hoặc quá mức."
  ],
  "VALIDATION_PRODUCTION_STAGES_A7BC7C1FB9": [
    "备份分层原料组成无效。",
    "The backup layered raw material composition is invalid.",
    "Thành phần nguyên liệu thô được xếp lớp dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_STAGES_4DB06C9AF5": [
    "备份层级原料组成不守恒。",
    "The raw material composition of the backup level is not conserved.",
    "Thành phần nguyên liệu thô của mức dự phòng không được bảo toàn."
  ],
  "VALIDATION_PRODUCTION_STAGES_CB51D2D0D7": [
    "备份半成品来源超额分配或数量成本不守恒。",
    "Backup work-in-process sources are over-allocated or quantity costs are not conserved.",
    "Các nguồn công việc đang xử lý dự phòng được phân bổ quá mức hoặc chi phí số lượng không được bảo toàn."
  ],
  "VALIDATION_PRODUCTION_STAGES_1217DE7DE8": [
    "备份根层原料追溯投影不一致。",
    "Backup root layer raw material traceback projection is inconsistent.",
    "Phép chiếu truy ngược nguyên liệu thô của lớp gốc dự phòng không nhất quán."
  ],
  "VALIDATION_PRODUCTION_STAGES_44109AC5E4": [
    "备份整单分层成本或结束状态不守恒。",
    "Backing up the entire single layer cost or end state is not conserved.",
    "Sao lưu toàn bộ chi phí một lớp hoặc trạng thái kết thúc không được bảo toàn."
  ],
  "VALIDATION_PRODUCTION_STAGES_3320A4820E": [
    "备份层级批次作废时间早于登记时间。",
    "The backup level batch invalidation time is earlier than the registration time.",
    "Thời gian vô hiệu hóa hàng loạt cấp độ sao lưu sớm hơn thời gian đăng ký."
  ],
  "VALIDATION_PRODUCTION_STAGES_2224FE5A9C": [
    "备份同一毫秒内的层级事件过多，无法安全确认登记及作废顺序。",
    "There are too many hierarchical events within the same millisecond of backup, and the registration and invalidation sequence cannot be safely confirmed.",
    "Có quá nhiều sự kiện phân cấp trong cùng một mili giây sao lưu và trình tự đăng ký và vô hiệu hóa không thể được xác nhận một cách an toàn."
  ],
  "VALIDATION_PRODUCTION_STAGES_3FE114A049": [
    "备份半成品分配与登记时的 FIFO、数量、成本或原料组成不一致。",
    "The backup work-in-process allocation is inconsistent with the FIFO, quantity, cost, or raw material composition at the time of registration.",
    "Việc phân bổ công việc trong quá trình dự phòng không nhất quán với FIFO, số lượng, chi phí hoặc thành phần nguyên liệu thô tại thời điểm đăng ký."
  ],
  "VALIDATION_PRODUCTION_06F257D865": [
    "生产单筛选或分页参数无效。",
    "The production order filtering or paging parameters are invalid.",
    "Các tham số lọc hoặc phân trang của lệnh sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_14C6169492": [
    "生产单编号无效。",
    "The production order number is invalid.",
    "Số lệnh sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_AF8DAA4686": [
    "生产单不存在或不属于当前仓库。",
    "The production order does not exist or does not belong to the current warehouse.",
    "Lệnh sản xuất không tồn tại hoặc không thuộc kho hiện tại."
  ],
  "VALIDATION_PRODUCTION_C4FC7F6FCA": [
    "请选择BOM并核对版本。",
    "Please select the BOM and check the version.",
    "Vui lòng chọn BOM và kiểm tra phiên bản."
  ],
  "VALIDATION_PRODUCTION_864F7E4A46": [
    "需要生产管理权限。",
    "Production management rights are required.",
    "Cần có quyền quản lý sản xuất."
  ],
  "VALIDATION_PRODUCTION_89CAC08A11": [
    "生产登记必须保留生产单，不能结束生产。",
    "Production registration must retain the production order and cannot end production.",
    "Đăng ký sản xuất phải giữ lại lệnh sản xuất và không thể kết thúc sản xuất."
  ],
  "VALIDATION_PRODUCTION_86E08D95C2": [
    "此生产单使用分层生产，请刷新页面后操作。",
    "This production order uses layered production, please refresh the page before proceeding.",
    "Lệnh sản xuất này sử dụng sản xuất theo lớp, vui lòng làm mới trang trước khi tiếp tục."
  ],
  "VALIDATION_PRODUCTION_57DEEBE83D": [
    "请选择有效生产组。",
    "Please select a valid production group.",
    "Vui lòng chọn một nhóm sản xuất hợp lệ."
  ],
  "VALIDATION_PRODUCTION_03774FA00B": [
    "此生产单使用多层配方，请刷新页面后操作。",
    "This production order uses a multi-layer formula, please refresh the page before proceeding.",
    "Lệnh sản xuất này sử dụng công thức nhiều lớp, vui lòng làm mới trang trước khi tiếp tục."
  ],
  "VALIDATION_PRODUCTION_6EED7CB5AE": [
    "生产单已变化，请重新读取后核对。当前填写内容已保留。",
    "The production order has changed, please read it again and check. The currently filled content has been retained.",
    "Lệnh sản xuất đã thay đổi, vui lòng đọc lại và kiểm tra. Nội dung hiện đang điền đã được giữ lại."
  ],
  "VALIDATION_PRODUCTION_AD3DE3ABBB": [
    "仅尚未登记批次的待生产单据可以编辑。",
    "Only documents to be produced that have not yet been registered as batches can be edited.",
    "Chỉ những tài liệu được sản xuất chưa được đăng ký theo lô mới có thể được chỉnh sửa."
  ],
  "VALIDATION_PRODUCTION_6BD80FECB5": [
    "{p0}单位已变化，请作废此草稿并按核对后的BOM重新建单。",
    "The unit of {p0} has changed. Please cancel this draft and create a new order based on the verified BOM.",
    "Đơn vị của {p0} đã thay đổi. Vui lòng hủy bản nháp này và tạo đơn hàng mới dựa trên BOM đã được xác minh."
  ],
  "VALIDATION_PRODUCTION_A164DF7009": [
    "{p0}单位已变化，无法按原单位作废。请先核对物料单位和后续业务。",
    "The unit of {p0} has changed and cannot be invalidated according to the original unit. Please check the material unit and subsequent business first.",
    "Đơn vị của {p0} đã thay đổi và không thể vô hiệu hóa theo đơn vị ban đầu. Vui lòng kiểm tra đơn vị nguyên liệu và hoạt động kinh doanh tiếp theo trước."
  ],
  "VALIDATION_PRODUCTION_2A9B37778C": [
    "生产登记地址与当前访问地址不一致。",
    "The production registration address is inconsistent with the current access address.",
    "Địa chỉ đăng ký sản xuất không nhất quán với địa chỉ truy cập hiện tại."
  ],
  "VALIDATION_PRODUCTION_6C8F74F1FD": [
    "下级配方已变化或尚未预览，请重新测算后保存。当前填写内容已保留。",
    "The lower-level formula has changed or has not been previewed. Please recalculate and save. The currently filled content has been retained.",
    "Công thức cấp thấp hơn đã thay đổi hoặc chưa được xem trước. Hãy tính toán lại và lưu lại. Nội dung hiện đang điền đã được giữ lại."
  ],
  "VALIDATION_PRODUCTION_AC01964216": [
    "新多层生产单使用分层生产，请刷新页面后建单。",
    "The new multi-layer production order uses layered production, please refresh the page before creating the order.",
    "Lệnh sản xuất nhiều lớp mới sử dụng sản xuất theo lớp, vui lòng làm mới trang trước khi tạo đơn hàng."
  ],
  "VALIDATION_PRODUCTION_88AE414647": [
    "请刷新页面后派工。",
    "Please refresh the page before dispatching work.",
    "Vui lòng làm mới trang trước khi gửi công việc."
  ],
  "VALIDATION_PRODUCTION_1777A4693C": [
    "请选择生产组或明确取消派工。",
    "Please select a production group or explicitly cancel the dispatch.",
    "Vui lòng chọn một nhóm sản xuất hoặc hủy bỏ việc gửi đi một cách rõ ràng."
  ],
  "VALIDATION_PRODUCTION_C8034EEB11": [
    "仅尚未开始且没有作业记录的待生产单可以派工。",
    "Only orders to be produced that have not yet been started and have no job records can be dispatched.",
    "Chỉ những đơn hàng được sản xuất chưa được bắt đầu và chưa có hồ sơ công việc mới có thể được gửi đi."
  ],
  "VALIDATION_PRODUCTION_495BDF95AB": [
    "仅待生产或生产中的单据可以登记完工。",
    "Only documents to be produced or in production can be registered as completed.",
    "Chỉ những tài liệu được sản xuất hoặc đang sản xuất mới có thể được đăng ký là đã hoàn thành."
  ],
  "VALIDATION_PRODUCTION_1FDAE24636": [
    "废料 {p0}库存不足（当前 {p1} {p2}，需扣回 {p3} {p4}）。",
    "The inventory of scrap {p0} is insufficient (currently {p1} {p2}, {p3} {p4} needs to be deducted).",
    "Tồn kho phế liệu {p0} không đủ (hiện tại {p1} {p2}, {p3} {p4} cần được khấu trừ)."
  ],
  "VALIDATION_PRODUCTION_4A3C3368D5": [
    "无法回退库存和原成本：{p0} 请先核对后续业务。",
    "Unable to return inventory and original cost: {p0} Please check subsequent business first.",
    "Không thể trả lại hàng tồn kho và giá gốc: {p0} Vui lòng kiểm tra hoạt động kinh doanh tiếp theo trước."
  ],
  "VALIDATION_PRODUCTION_C7E57530CB": [
    "分层生产请按指定层登记，不能通过旧登记入口完成。",
    "For layered production, please register according to the designated layer and cannot be completed through the old registration entrance.",
    "Đối với sản xuất theo lớp, vui lòng đăng ký theo lớp được chỉ định và không thể hoàn thành thông qua lối vào đăng ký cũ."
  ],
  "VALIDATION_PRODUCTION_8BD6DCAC6D": [
    "每张生产单最多登记 1000 个批次，请拆分生产单。",
    "Each production order can register up to 1,000 batches. Please split the production order.",
    "Mỗi đơn hàng sản xuất có thể đăng ký tối đa 1.000 lô. Hãy chia nhỏ lệnh sản xuất."
  ],
  "VALIDATION_PRODUCTION_07A515F142": [
    "{p0}库存不足，请联系仓库核对实际耗料。",
    "{p0} is out of stock, please contact the warehouse to check the actual consumption.",
    "{p0} hết hàng, vui lòng liên hệ kho để kiểm tra lượng tiêu thụ thực tế."
  ],
  "VALIDATION_PRODUCTION_EC108F38DD": [
    "{p0}已领未耗余额不足（当前 {p2} {p3}）。请补料或核对实际耗料。",
    "The issued, unconsumed balance for {p0} is insufficient (current: {p2} {p3}). Request additional materials or check actual consumption.",
    "Không đủ số dư đã lĩnh nhưng chưa tiêu hao của {p0} (hiện có: {p2} {p3}). Yêu cầu bổ sung vật tư hoặc kiểm tra tiêu hao thực tế."
  ],
  "VALIDATION_PRODUCTION_4CE7FEDF02": [
    "{p0}库存不足（当前 {p2} {p3}）。请补料或核对实际耗料。",
    "Insufficient stock for {p0} (current: {p2} {p3}). Request additional materials or check actual consumption.",
    "Không đủ tồn kho cho {p0} (hiện có: {p2} {p3}). Yêu cầu bổ sung vật tư hoặc kiểm tra tiêu hao thực tế."
  ],
  "VALIDATION_PRODUCTION_C58A3A329E": [
    "{p0}{p1}不足（当前 {p2} {p3}）。请补料或核对实际耗料。",
    "Insufficient {p0}{p1} (currently {p2} {p3}). Please refill or check the actual consumption.",
    "Không đủ {p0}{p1} (hiện tại là {p2} {p3}). Vui lòng nạp lại hoặc kiểm tra mức tiêu thụ thực tế."
  ],
  "VALIDATION_PRODUCTION_1F85EBB3F1": [
    "本次材料成本超出范围，请拆分生产单。",
    "This time the material cost is out of range, please split the production order.",
    "Lần này chi phí nguyên vật liệu nằm ngoài phạm vi cho phép, vui lòng chia nhỏ lệnh sản xuất."
  ],
  "VALIDATION_PRODUCTION_FE19AD1B3B": [
    "请先登记至少一个有效完工批次。",
    "Please register at least one valid completed batch first.",
    "Vui lòng đăng ký ít nhất một đợt hoàn thành hợp lệ trước."
  ],
  "VALIDATION_PRODUCTION_57C518D39E": [
    "分层生产请从层级批次入口作废。",
    "For hierarchical production, please cancel from the hierarchical batch entrance.",
    "Để sản xuất theo cấp bậc, vui lòng hủy khỏi lối vào lô theo cấp bậc."
  ],
  "VALIDATION_PRODUCTION_0C36A377C5": [
    "完工批次不存在或不属于此生产单。",
    "The finished batch does not exist or does not belong to this production order.",
    "Lô hoàn thiện không tồn tại hoặc không thuộc lệnh sản xuất này."
  ],
  "VALIDATION_PRODUCTION_26E45386F3": [
    "此完工批次已经作废。",
    "This completed batch has been cancelled.",
    "Lô hoàn thành này đã bị hủy bỏ."
  ],
  "VALIDATION_PRODUCTION_2270B11071": [
    "请先自上而下作废所有有效层级批次。",
    "Please invalidate all valid level batches from top to bottom first.",
    "Vui lòng vô hiệu hóa tất cả các lô cấp độ hợp lệ từ trên xuống dưới trước."
  ],
  "VALIDATION_PRODUCTION_BBA269A8CA": [
    "请先作废所有有效批次，并通过仓库退回全部剩余材料，再作废生产单。",
    "Please void all valid batches first and return all remaining materials through the warehouse before voiding the production order.",
    "Vui lòng hủy tất cả các lô hợp lệ trước và trả lại tất cả nguyên liệu còn lại qua kho trước khi hủy đơn đặt hàng sản xuất."
  ],
  "VALIDATION_PRODUCTION_680502BEFA": [
    "仅已作废的生产单可以删除，请先作废。",
    "Only voided production orders can be deleted, please void them first.",
    "Chỉ có thể xóa các đơn đặt hàng sản xuất bị vô hiệu, vui lòng hủy chúng trước."
  ],
  "VALIDATION_PRODUCTION_F13B2821B2": [
    "备份生产材料关联无效。",
    "Backup production material association is invalid.",
    "Liên kết vật liệu sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_ADC5C57053": [
    "备份生产废料关联无效。",
    "The backup production scrap association is invalid.",
    "Liên kết phế liệu sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_C7C0134960": [
    "备份生产配方节点关联无效。",
    "The backup production recipe node association is invalid.",
    "Liên kết nút công thức sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_9F238D6AFD": [
    "备份生产配方节点跨仓库或关联无效。",
    "The backup production recipe node is invalid across warehouses or associated.",
    "Nút công thức sản xuất dự phòng không hợp lệ trên các kho hoặc được liên kết."
  ],
  "VALIDATION_PRODUCTION_68AC8F03EC": [
    "备份生产配方快照格式无效。",
    "The backup production recipe snapshot format is invalid.",
    "Định dạng ảnh chụp nhanh công thức sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_91F0849B5A": [
    "备份多层生产材料汇总无效。",
    "Backing up multi-level production material summaries is not valid.",
    "Sao lưu bản tóm tắt vật tư sản xuất đa cấp là không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_B6553F73BE": [
    "备份生产单字段、状态或关联无效。",
    "The backup production order field, status or association is invalid.",
    "Trường, trạng thái hoặc liên kết của lệnh sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_460C2B50A0": [
    "备份生产废料排序重复。",
    "Backup production scrap sort duplication.",
    "Sao lưu phân loại phế liệu sản xuất trùng lặp."
  ],
  "VALIDATION_PRODUCTION_CA5F719217": [
    "备份生产废料数量、处理方式或快照无效。",
    "The backup production scrap quantity, processing method or snapshot is invalid.",
    "Số lượng phế liệu sản xuất dự phòng, phương pháp xử lý hoặc ảnh chụp nhanh không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_9CD71EDB90": [
    "备份材料取整属性无效。",
    "The backup material rounding attribute is invalid.",
    "Thuộc tính làm tròn vật liệu dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_7D1A4EAAAA": [
    "多层生产材料不能伪造单层基准用量。",
    "Multi-layer production materials cannot falsify single-layer benchmark usage.",
    "Vật liệu sản xuất nhiều lớp không thể làm sai lệch việc sử dụng điểm chuẩn một lớp."
  ],
  "VALIDATION_PRODUCTION_3FCD221159": [
    "备份生产材料与节点来源快照不一致。",
    "The backup production material is inconsistent with the node source snapshot.",
    "vật tư sản xuất dự phòng không nhất quán với ảnh chụp nhanh nguồn nút."
  ],
  "VALIDATION_PRODUCTION_21DF8E4723": [
    "备份生产材料数量、成本或快照无效。",
    "The backup production material quantity, cost, or snapshot is not valid.",
    "Số lượng, chi phí hoặc ảnh chụp nhanh vật liệu sản xuất dự phòng không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_405A4D00B7": [
    "备份生产材料与成品成本不一致。",
    "Backup production materials are inconsistent with finished product costs.",
    "Nguyên vật liệu sản xuất dự phòng không phù hợp với giá thành thành phẩm."
  ],
  "VALIDATION_PRODUCTION_4F25157C97": [
    "备份生产单累计记录与有效批次不一致。",
    "The backup production order cumulative record is inconsistent with the effective batch.",
    "Bản ghi tích lũy lệnh sản xuất dự phòng không nhất quán với lô hiệu quả."
  ],
  "VALIDATION_PRODUCTION_DAF402A6C0": [
    "备份完工批次明细关联无效。",
    "The backup completion batch detail association is invalid.",
    "Liên kết chi tiết lô hoàn thành sao lưu không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_8BE49783D2": [
    "备份完工批次字段或状态无效。",
    "The backup completion lot field or status is invalid.",
    "Trường hoặc trạng thái lô hoàn thành sao lưu không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_7DB307CF0D": [
    "备份分层根批次原料投影无效。",
    "Backup layered root batch raw material projection is invalid.",
    "Phép chiếu nguyên liệu thô của lớp gốc sao lưu không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_EC0EC49ADF": [
    "备份完工批次材料成本或差异原因无效。",
    "Invalid backup of finished batch material costs or variance reasons.",
    "Bản sao lưu không hợp lệ của chi phí nguyên liệu lô thành phẩm hoặc lý do chênh lệch."
  ],
  "VALIDATION_PRODUCTION_D8C054A05A": [
    "备份完工批次预计废料与规则不一致。",
    "The backup completion batch estimated scrap is inconsistent with the rules.",
    "Phế liệu ước tính của lô hoàn thành sao lưu không phù hợp với các quy tắc."
  ],
  "VALIDATION_PRODUCTION_E66B0D7D17": [
    "备份完工批次序号重复。",
    "The backup completed batch serial number is duplicated.",
    "Số sê-ri lô đã hoàn thành sao lưu bị trùng lặp."
  ],
  "VALIDATION_QUALITY_CHARTS_854318FC25": [
    "备份品质图表无效。",
    "The backup quality chart is invalid.",
    "Biểu đồ chất lượng sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHARTS_6DFECAA86E": [
    "备份品质图表配置无效。",
    "Invalid backup quality chart configuration.",
    "Cấu hình biểu đồ chất lượng sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHARTS_1D476C982A": [
    "模板发布版本不存在或不属于当前仓库。",
    "The template release version does not exist or does not belong to the current warehouse.",
    "Phiên bản phát hành mẫu không tồn tại hoặc không thuộc về kho hiện tại."
  ],
  "VALIDATION_QUALITY_CHARTS_D9139F8530": [
    "验收单超过 2000 张，请先选择单张验收单缩小统计范围。",
    "There are more than 2,000 acceptance forms. Please select a single acceptance form first to narrow the statistical range.",
    "Có hơn 2.000 hình thức chấp nhận. Vui lòng chọn một biểu mẫu chấp nhận duy nhất trước tiên để thu hẹp phạm vi thống kê."
  ],
  "VALIDATION_QUALITY_CHARTS_B7A12A2751": [
    "请输入 1–60 字的图表名称。",
    "Please enter a chart name of 1–60 characters.",
    "Vui lòng nhập tên biểu đồ từ 1–60 ký tự."
  ],
  "VALIDATION_QUALITY_CHARTS_36A4016EF1": [
    "模板与发布版本不匹配。",
    "Template does not match release version.",
    "Mẫu không khớp với phiên bản phát hành."
  ],
  "VALIDATION_QUALITY_CHARTS_D64A4AE7F1": [
    "图表不存在或不属于当前仓库。",
    "The chart does not exist or does not belong to the current warehouse.",
    "Biểu đồ không tồn tại hoặc không thuộc về kho hiện tại."
  ],
  "VALIDATION_QUALITY_CHARTS_CBBCD579A8": [
    "图表已被修改，请保留配置并重新打开。",
    "The chart has been modified, please keep the configuration and reopen it.",
    "Biểu đồ đã được sửa đổi, vui lòng giữ nguyên cấu hình và mở lại."
  ],
  "VALIDATION_QUALITY_CHARTS_432F52436C": [
    "图表筛选条件无效。",
    "Invalid chart filter.",
    "Bộ lọc biểu đồ không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHARTS_15393DAA1F": [
    "原图表已删除，请使用新的操作标识。",
    "The original chart has been deleted, please use a new operation ID.",
    "Biểu đồ gốc đã bị xóa, vui lòng sử dụng ID hoạt động mới."
  ],
  "VALIDATION_QUALITY_CHARTS_3A5A50E51A": [
    "图表启用状态无效。",
    "Chart enable status is invalid.",
    "Trạng thái bật biểu đồ không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHARTS_8DBBD70E4A": [
    "图表来源查询条件无效。",
    "The chart source query condition is invalid.",
    "Điều kiện truy vấn nguồn biểu đồ không hợp lệ."
  ],
  "VALIDATION_QUALITY_3C1FC84F83": [
    "备份 Excel 文件引用无效。",
    "The backup Excel file reference is invalid.",
    "Tham chiếu tệp Excel sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_4FFB99120A": [
    "备份工作簿无效。",
    "The backup workbook is not valid.",
    "Sổ làm việc sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_5D7F32ECBE": [
    "备份工作表无效。",
    "The backup worksheet is invalid.",
    "Bảng tính sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_735CC5321A": [
    "备份工作表已用范围无效。",
    "The used range of the backup worksheet is invalid.",
    "Phạm vi được sử dụng của bảng tính sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_6082AB97C3": [
    "备份单元格无效。",
    "The backup cell is invalid.",
    "Ô sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_79ECD0610C": [
    "备份合并区域无效。",
    "The backup merge area is invalid.",
    "Khu vực hợp nhất dự phòng không hợp lệ."
  ],
  "VALIDATION_QUALITY_4F02EEB4D7": [
    "备份品质模板无效。",
    "The backup quality template is invalid.",
    "Mẫu chất lượng sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_6B404C029C": [
    "模板发布版本关联无效。",
    "The template release version association is invalid.",
    "Liên kết phiên bản phát hành mẫu không hợp lệ."
  ],
  "VALIDATION_QUALITY_AEC2380BE0": [
    "模板缺少启用版本。",
    "The template is missing an enabled version.",
    "Mẫu thiếu phiên bản được kích hoạt."
  ],
  "VALIDATION_QUALITY_F74EEAA797": [
    "备份品质模板版本无效。",
    "The backup quality template version is invalid.",
    "Phiên bản mẫu chất lượng sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_D9C186D6AE": [
    "备份品质操作记录无效。",
    "The backup quality operation record is invalid.",
    "Bản ghi hoạt động chất lượng sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_C465111B8E": [
    "备份验收单关联或字段无效。",
    "The backup acceptance document association or field is invalid.",
    "Liên kết hoặc trường tài liệu chấp nhận sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_CB00B5339E": [
    "备份验收单工作表结果无效。",
    "The result of the backup acceptance sheet worksheet is invalid.",
    "Kết quả của bảng tính chấp nhận sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_960DB28BB4": [
    "备份验收单缺少核对确认。",
    "The backup acceptance form lacks verification confirmation.",
    "Biểu mẫu chấp nhận sao lưu thiếu xác nhận xác minh."
  ],
  "VALIDATION_QUALITY_F85E5CF3AD": [
    "备份验收单解析数据不一致。",
    "The backup acceptance document parsing data is inconsistent.",
    "Dữ liệu phân tích tài liệu chấp nhận sao lưu không nhất quán."
  ],
  "VALIDATION_QUALITY_DE581DF78D": [
    "备份验收单物料绑定数据无效。",
    "The backup acceptance document material binding data is invalid.",
    "Dữ liệu ràng buộc vật tư chấp nhận sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_281EC0A6E5": [
    "备份验收单物料绑定工作表无效。",
    "The backup acceptance document material binding worksheet is invalid.",
    "Bảng tính ràng buộc vật tư chấp nhận dự phòng không hợp lệ."
  ],
  "VALIDATION_QUALITY_32912732DF": [
    "备份验收单物料绑定无效。",
    "The material binding of the backup acceptance document is invalid.",
    "Ràng buộc vật chất của vật tư chấp nhận sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_C058705760": [
    "备份验收单未绑定物料的数据无效。",
    "The data of unbound materials in the backup acceptance form is invalid.",
    "Dữ liệu của các vật tư không được liên kết trong biểu mẫu chấp nhận sao lưu không hợp lệ."
  ],
  "VALIDATION_QUALITY_56E2AB4B5F": [
    "备份验收单绑定的物料或快照无效。",
    "The material or snapshot bound to the backup acceptance document is invalid.",
    "vật tư hoặc ảnh chụp nhanh được liên kết với vật tư chấp nhận dự phòng không hợp lệ."
  ],
  "VALIDATION_QUALITY_55DFA52E45": [
    "原文件大小无效。",
    "The original file size is invalid.",
    "Kích thước tập tin gốc không hợp lệ."
  ],
  "VALIDATION_QUALITY_345273E126": [
    "没有品质管理权限。",
    "No quality management authority.",
    "Không có cơ quan quản lý chất lượng."
  ],
  "VALIDATION_QUALITY_DF317E63A8": [
    "请管理员先在系统设置中配置 R2 账户、存储桶和访问凭据。",
    "Ask the administrator to first configure the R2 account, bucket, and access credentials in system settings.",
    "Trước tiên, hãy yêu cầu quản trị viên định cấu hình tài khoản R2, bộ chứa và thông tin xác thực truy cập trong cài đặt hệ thống."
  ],
  "VALIDATION_QUALITY_0EBB4B17C9": [
    "原文件位于此前的 R2 账户或存储桶，请管理员迁移或恢复连接配置。",
    "The original file is located in the previous R2 account or bucket. Please ask the administrator to migrate or restore the connection configuration.",
    "Tệp gốc nằm trong tài khoản hoặc nhóm R2 trước đó. Vui lòng yêu cầu quản trị viên di chuyển hoặc khôi phục cấu hình kết nối."
  ],
  "VALIDATION_QUALITY_808DB10150": [
    "模板不存在或不属于当前仓库。",
    "The template does not exist or does not belong to the current repository.",
    "Mẫu không tồn tại hoặc không thuộc về kho lưu trữ hiện tại."
  ],
  "VALIDATION_QUALITY_788082FCE4": [
    "模板已被修改，请保留当前内容并重新打开。",
    "The template has been modified, please keep the current content and reopen it.",
    "Bản mẫu đã được sửa đổi, vui lòng giữ nguyên nội dung hiện tại và mở lại."
  ],
  "VALIDATION_QUALITY_BF3E718426": [
    "Excel 文件不能超过 10 MB。",
    "Excel files cannot exceed 10 MB.",
    "Tệp Excel không thể vượt quá 10 MB."
  ],
  "VALIDATION_QUALITY_D8704381A7": [
    "上传内容无效或过大。",
    "The uploaded content is invalid or too large.",
    "Nội dung tải lên không hợp lệ hoặc quá lớn."
  ],
  "VALIDATION_QUALITY_BB9BB15021": [
    "请选择 .xlsx 文件。",
    "Please select the .xlsx file.",
    "Vui lòng chọn tệp .xlsx."
  ],
  "VALIDATION_QUALITY_F9E5B28941": [
    "验收单不存在或不属于当前仓库。",
    "The acceptance document does not exist or does not belong to the current warehouse.",
    "Biên bản nghiệm thu không tồn tại hoặc không thuộc kho hiện tại."
  ],
  "VALIDATION_QUALITY_095EC1C4C5": [
    "模板已停用或发布版本已变化，请重新选择模板并解析。",
    "The template has been deactivated or the release version has changed. Please select the template again and parse it.",
    "Mẫu đã bị vô hiệu hóa hoặc phiên bản phát hành đã thay đổi. Vui lòng chọn lại mẫu và phân tích nó."
  ],
  "VALIDATION_QUALITY_F833CC2856": [
    "请选择上传文件中的 1–20 个不重复的数据工作表。",
    "Please select 1–20 unique data sheets in the upload file.",
    "Vui lòng chọn 1–20 bảng dữ liệu duy nhất trong tệp tải lên."
  ],
  "VALIDATION_QUALITY_6963FCC8DA": [
    "解析结果超过 5 MB，请减少填写内容或模板字段范围。",
    "The parsed result exceeds 5 MB, please reduce the content or template field range.",
    "Kết quả được phân tích cú pháp vượt quá 5 MB, vui lòng giảm phạm vi trường nội dung hoặc mẫu."
  ],
  "VALIDATION_QUALITY_29BD1253F6": [
    "物料绑定数据无效。",
    "The material binding data is invalid.",
    "Dữ liệu ràng buộc vật tư không hợp lệ."
  ],
  "VALIDATION_QUALITY_A3448E8F8A": [
    "请逐个确认所选工作表的物料绑定。",
    "Please confirm the material binding of the selected worksheet one by one.",
    "Vui lòng xác nhận lần lượt ràng buộc vật tư của bảng tính đã chọn."
  ],
  "VALIDATION_QUALITY_4F14A8E45C": [
    "请为工作表“{p0}”选择物料，或取消绑定。",
    "Select a material for worksheet “{p0}”, or remove the binding.",
    "Chọn vật tư cho trang tính “{p0}” hoặc bỏ liên kết."
  ],
  "VALIDATION_QUALITY_EF7E4EAC6A": [
    "工作表“{p0}”选择的物料不存在、已停用或不属于当前仓库，请重新选择。",
    "The material selected for worksheet “{p0}” does not exist, is disabled or belongs to another warehouse. Select it again.",
    "Vật tư được chọn cho trang tính “{p0}” không tồn tại, đã ngừng sử dụng hoặc không thuộc kho hiện tại. Vui lòng chọn lại."
  ],
  "VALIDATION_QUALITY_1ABB9642F8": [
    "工作表“{p0}”的自动匹配结果已变化，请重新解析或手动选择物料。",
    "The automatic match for worksheet “{p0}” has changed. Parse it again or select the material manually.",
    "Kết quả khớp tự động của trang tính “{p0}” đã thay đổi. Phân tích lại hoặc chọn vật tư thủ công."
  ],
  "VALIDATION_QUALITY_21DBDA8FB6": [
    "解析预览已失效或文件已变化，请重新上传解析后确认。",
    "The analysis preview has expired or the file has changed. Please re-upload the analysis and confirm.",
    "Bản xem trước phân tích đã hết hạn hoặc tệp đã thay đổi. Vui lòng tải lên lại bản phân tích và xác nhận."
  ],
  "VALIDATION_QUALITY_0F85C64723": [
    "物料匹配条件无效。",
    "The material matching condition is invalid.",
    "Điều kiện khớp vật liệu không hợp lệ."
  ],
  "VALIDATION_QUALITY_6A19E813F8": [
    "物料搜索条件无效。",
    "Invalid material search criteria.",
    "Tiêu chí tìm kiếm vật tư không hợp lệ."
  ],
  "VALIDATION_QUALITY_DEC228DBDB": [
    "分页位置无效。",
    "Invalid pagination position.",
    "Vị trí phân trang không hợp lệ."
  ],
  "VALIDATION_QUALITY_72B05AB24E": [
    "手动修正数据格式无效。",
    "Manually correcting the data format is invalid.",
    "Việc sửa định dạng dữ liệu theo cách thủ công là không hợp lệ."
  ],
  "VALIDATION_QUALITY_79ED0D6DDF": [
    "手动修正数据必须是数组。",
    "Manual correction data must be an array.",
    "Dữ liệu chỉnh sửa thủ công phải là một mảng."
  ],
  "VALIDATION_QUALITY_69495ABD48": [
    "请输入 1–100 字验收单名称，备注不超过 1000 字。",
    "Please enter a name of 1-100 words for the acceptance form, and the remarks should not exceed 1000 words.",
    "Vui lòng nhập tên từ 1-100 từ cho biểu mẫu chấp nhận và nhận xét không được vượt quá 1000 từ."
  ],
  "VALIDATION_QUALITY_174D128194": [
    "验收单仍有解析错误，请在定位面板手动修正，或修正 Excel 并重新上传。",
    "There are still parsing errors in the acceptance form. Please correct it manually in the positioning panel, or correct it in Excel and upload it again.",
    "Vẫn còn lỗi phân tích cú pháp trong biểu mẫu chấp nhận. Vui lòng sửa thủ công trong bảng định vị hoặc sửa trong Excel và tải lại."
  ],
  "VALIDATION_QUALITY_7AA2BBE6D2": [
    "请先核对系统发现的差异及待确认项，再确认保留原报告结果。",
    "Please check the differences found by the system and items to be confirmed first, and then confirm to retain the original report results.",
    "Vui lòng kiểm tra sự khác biệt mà hệ thống tìm thấy và các mục cần xác nhận trước, sau đó xác nhận để giữ lại kết quả báo cáo ban đầu."
  ],
  "VALIDATION_QUALITY_C18B070416": [
    "验收单原始 Excel 上传失败，请检查存储连接及写入权限。",
    "The original Excel upload of the acceptance form failed, please check the storage connection and write permission.",
    "Tải lên biểu mẫu chấp nhận ban đầu không thành công, vui lòng kiểm tra kết nối lưu trữ và quyền ghi."
  ],
  "VALIDATION_QUALITY_9390C31A3C": [
    "读取验收单原始 Excel 失败，请检查文件及存储连接。",
    "Failed to read the original Excel of the acceptance form, please check the file and storage connection.",
    "Không đọc được Excel gốc của biểu mẫu chấp nhận, vui lòng kiểm tra kết nối tệp và lưu trữ."
  ],
  "VALIDATION_QUALITY_A3712DABB7": [
    "验收单原始 Excel 校验失败。",
    "The original Excel verification of the acceptance form failed.",
    "Việc xác minh Excel ban đầu của biểu mẫu chấp nhận không thành công."
  ],
  "VALIDATION_QUALITY_FCEF7E6263": [
    "请输入 1–60 字模板名称。",
    "Please enter a template name of 1–60 characters.",
    "Vui lòng nhập tên mẫu từ 1–60 ký tự."
  ],
  "VALIDATION_QUALITY_E7133ECD6A": [
    "Excel 上传 R2 失败，请检查连接和目录写入权限。",
    "Excel upload R2 failed, please check connection and directory write permissions.",
    "Tải lên Excel R2 không thành công, vui lòng kiểm tra quyền kết nối và ghi thư mục."
  ],
  "VALIDATION_QUALITY_1726340A47": [
    "模板名称或说明无效。",
    "The template name or description is invalid.",
    "Tên mẫu hoặc mô tả không hợp lệ."
  ],
  "VALIDATION_QUALITY_548D0D1F82": [
    "Excel 上传 R2 失败，原模板未修改。",
    "Excel failed to upload R2, the original template has not been modified.",
    "Excel không tải lên được R2, mẫu gốc chưa được sửa đổi."
  ],
  "VALIDATION_QUALITY_D496CC0892": [
    "R2 原始 Excel 不可读取，暂时不能启用模板。",
    "R2 The original Excel cannot be read and the template cannot be enabled at the moment.",
    "R2 Hiện tại không thể đọc được Excel gốc và không thể bật mẫu."
  ],
  "VALIDATION_QUALITY_5CD069E0D1": [
    "请先发布模板。",
    "Please publish the template first.",
    "Vui lòng xuất bản mẫu trước."
  ],
  "VALIDATION_QUALITY_2826871194": [
    "该版本尚未启用或已停用。",
    "This version is not enabled or disabled.",
    "Phiên bản này không được kích hoạt hoặc vô hiệu hóa."
  ],
  "VALIDATION_QUALITY_56ACEB9699": [
    "读取 R2 原始 Excel 失败，请检查文件及连接。",
    "Failed to read R2 original Excel, please check the file and connection.",
    "Không đọc được Excel gốc R2, vui lòng kiểm tra tệp và kết nối."
  ],
  "VALIDATION_QUALITY_1EC30887EF": [
    "原始 Excel 校验失败，请联系管理员。",
    "Original Excel verification failed, please contact your administrator.",
    "Xác minh Excel gốc không thành công, vui lòng liên hệ với quản trị viên của bạn."
  ],
  "VALIDATION_QUALITY_3A82B47ACA": [
    "配置格式无效。",
    "The configuration format is invalid.",
    "Định dạng cấu hình không hợp lệ."
  ],
  "VALIDATION_QUALITY_9975E806B2": [
    "模板操作失败。",
    "Template operation failed.",
    "Thao tác mẫu không thành công."
  ],
  "VALIDATION_QUERIES_6E3C7D2849": [
    "筛选参数无效。",
    "Invalid filter parameter.",
    "Tham số bộ lọc không hợp lệ."
  ],
  "VALIDATION_QUERIES_1B8F89B69F": [
    "分页参数无效。",
    "The pagination parameter is invalid.",
    "Tham số phân trang không hợp lệ."
  ],
  "VALIDATION_QUERIES_E06514E112": [
    "分页参数超出范围。",
    "Paging parameter is out of range.",
    "Tham số phân trang nằm ngoài phạm vi."
  ],
  "VALIDATION_QUERIES_9A8A445E0D": [
    "搜索关键词无效。",
    "The search keyword is invalid.",
    "Từ khóa tìm kiếm không hợp lệ."
  ],
  "VALIDATION_QUERIES_857D423FEB": [
    "分类筛选无效。",
    "Category filtering is invalid.",
    "Lọc danh mục không hợp lệ."
  ],
  "VALIDATION_R2_BACKUP_B46FC51D23": [
    "Cron 必须为五段：分 时 日 月 周。",
    "Cron must be five segments: minute, hour, day, month, and week.",
    "Cron phải có năm phân đoạn: phút, giờ, ngày, tháng và tuần."
  ],
  "VALIDATION_R2_BACKUP_B896833F3B": [
    "Cron 或时区无效，请检查配置。",
    "Invalid cron or time zone, please check configuration.",
    "Cron hoặc múi giờ không hợp lệ, vui lòng kiểm tra cấu hình."
  ],
  "VALIDATION_R2_BACKUP_965BB58929": [
    "备份已上传，但旧备份清理失败，请检查 R2 列举和删除权限及网络；下次成功备份后会再次清理。",
    "The backup has been uploaded, but the old backup failed to be cleaned. Please check the R2 enumeration and deletion permissions and network; it will be cleaned again after the next successful backup.",
    "Bản sao lưu đã được tải lên nhưng bản sao lưu cũ không được dọn sạch. Vui lòng kiểm tra mạng và quyền liệt kê và xóa R2; nó sẽ được làm sạch lại sau lần sao lưu thành công tiếp theo."
  ],
  "VALIDATION_R2_BACKUP_660AB3F79F": [
    "备份配置已变化，请重新打开设置。",
    "The backup configuration has changed, please reopen the settings.",
    "Cấu hình sao lưu đã thay đổi, vui lòng mở lại cài đặt."
  ],
  "VALIDATION_R2_BACKUP_250F16595F": [
    "备份配置格式无效。",
    "The backup configuration format is invalid.",
    "Định dạng cấu hình sao lưu không hợp lệ."
  ],
  "VALIDATION_R2_BACKUP_DA7CFFF721": [
    "R2 Account ID 应为 32 位十六进制字符。",
    "R2 Account ID should be 32 hexadecimal characters.",
    "ID tài khoản R2 phải có 32 ký tự thập lục phân."
  ],
  "VALIDATION_R2_BACKUP_F48626B390": [
    "R2 存储桶名称无效。",
    "R2 bucket name is invalid.",
    "Tên nhóm R2 không hợp lệ."
  ],
  "VALIDATION_R2_BACKUP_B4B1D668EB": [
    "备份目录仅支持字母、数字、斜线、下划线和短横线。",
    "The backup directory only supports letters, numbers, slashes, underscores and dashes.",
    "Thư mục sao lưu chỉ hỗ trợ chữ cái, số, dấu gạch chéo, dấu gạch dưới và dấu gạch ngang."
  ],
  "VALIDATION_R2_BACKUP_0DEF0D2ACB": [
    "Excel 目录前缀无效。",
    "The Excel directory prefix is invalid.",
    "Tiền tố thư mục Excel không hợp lệ."
  ],
  "VALIDATION_R2_BACKUP_46476EB53A": [
    "Excel 目录前缀必填，仅支持字母、数字、斜线、下划线和短横线。",
    "Excel directory prefix is required and only supports letters, numbers, slashes, underlines and dashes.",
    "Tiền tố thư mục Excel là bắt buộc và chỉ hỗ trợ các chữ cái, số, dấu gạch chéo, gạch chân và dấu gạch ngang."
  ],
  "VALIDATION_R2_BACKUP_19FCA56FD7": [
    "Excel 目录前缀不能与备份目录前缀相同。",
    "The Excel directory prefix cannot be the same as the backup directory prefix.",
    "Tiền tố thư mục Excel không thể giống với tiền tố thư mục dự phòng."
  ],
  "VALIDATION_R2_BACKUP_EFB2139454": [
    "{p0} 必须为文本。",
    "{p0} must be text.",
    "{p0} phải là văn bản."
  ],
  "VALIDATION_R2_BACKUP_E56B27096D": [
    "{p0} 长度不能超过 4096 个字符。",
    "{p0} cannot exceed 4096 characters in length.",
    "{p0} không thể dài quá 4096 ký tự."
  ],
  "VALIDATION_R2_BACKUP_D4A285D3D0": [
    "{p0} 中间含有空白或不可见字符，请重新复制对应的凭据。",
    "{p0} contains blank or invisible characters, please copy the corresponding credentials again.",
    "{p0} chứa các ký tự trống hoặc ẩn, vui lòng sao chép lại thông tin đăng nhập tương ứng."
  ],
  "VALIDATION_R2_BACKUP_0CB894C427": [
    "清除凭据选项无效。",
    "Clear credentials option has no effect.",
    "Tùy chọn xóa thông tin xác thực không có hiệu lực."
  ],
  "VALIDATION_R2_BACKUP_0AABEBC1DA": [
    "启用前请填写 R2 账户、存储桶和访问凭据。",
    "Please fill in the R2 account, bucket, and access credentials before enabling.",
    "Vui lòng điền vào tài khoản R2, nhóm và thông tin đăng nhập trước khi kích hoạt."
  ],
  "VALIDATION_R2_BACKUP_8524B3E14D": [
    "配置已变化，请重新打开设置。",
    "The configuration has changed, please reopen the settings.",
    "Cấu hình đã thay đổi, vui lòng mở lại cài đặt."
  ],
  "VALIDATION_R2_BACKUP_50BBCE1532": [
    "请先保存完整的 R2 配置。",
    "Please save the complete R2 configuration first.",
    "Vui lòng lưu cấu hình R2 hoàn chỉnh trước."
  ],
  "VALIDATION_R2_BACKUP_EEC3547E7E": [
    "已有备份正在执行，请稍后再试。",
    "A backup is already being executed, please try again later.",
    "Một bản sao lưu đang được thực thi, vui lòng thử lại sau."
  ],
  "VALIDATION_STOCK_QR_A23151CAC6": [
    "物料条码或单位已变化，请管理员核对并保存配置。",
    "The material barcode or unit has changed. Please check and save the configuration.",
    "Mã vạch hoặc đơn vị vật liệu đã thay đổi. Vui lòng kiểm tra và lưu cấu hình."
  ],
  "VALIDATION_STOCK_QR_88332581D8": [
    "库存不足（当前 {p0} {p1}，需要 {p2} {p3}）。",
    "Out of stock (currently {p0} {p1}, requires {p2} {p3}).",
    "Hết hàng (hiện tại là {p0} {p1}, yêu cầu {p2} {p3})."
  ],
  "VALIDATION_STOCK_QR_A964F2B09F": [
    "入库后库存超出上限。",
    "The inventory exceeds the upper limit after storage.",
    "Hàng tồn kho vượt quá giới hạn trên sau khi lưu trữ."
  ],
  "VALIDATION_TABLE_MIGRATION_53552CFF93": [
    "表结构迁移不能嵌套在业务事务内。",
    "Table structure migration cannot be nested within business transactions.",
    "Di chuyển cấu trúc bảng không thể được lồng trong các giao dịch kinh doanh."
  ],
  "VALIDATION_TABLE_MIGRATION_403F870E29": [
    "表结构迁移外键检查失败。",
    "Table structure migration foreign key check failed.",
    "Kiểm tra khóa ngoại di chuyển cấu trúc bảng không thành công."
  ],
  "VALIDATION_TRANSFERS_3B18508E7A": [
    "无法在调入仓库建立物料「{p0}」档案。",
    "The material \"{p0}\" file cannot be created in the transferred warehouse.",
    "Không thể tạo tệp \"{p0}\" trong kho đã chuyển."
  ],
  "VALIDATION_TRANSFERS_BFBA7E0007": [
    "调拨记录分页参数无效。",
    "The transfer record paging parameter is invalid.",
    "Tham số phân trang bản ghi chuyển không hợp lệ."
  ],
  "VALIDATION_TRANSFERS_3ADA3B67AE": [
    "请选择调入仓库。",
    "Please select transfer to warehouse.",
    "Vui lòng chọn chuyển về kho."
  ],
  "VALIDATION_TRANSFERS_AF16A8CB83": [
    "调入仓库不存在，请刷新后重试。",
    "The transferred warehouse does not exist, please refresh and try again.",
    "Kho đã chuyển không tồn tại, vui lòng làm mới và thử lại."
  ],
  "VALIDATION_TRANSFERS_80EEC47DA2": [
    "调拨原因最多 500 字。",
    "Reason for transfer can be up to 500 words.",
    "Lý do chuyển có thể lên tới 500 từ."
  ],
  "VALIDATION_TRANSFERS_B53CB86451": [
    "每次调拨请选择 1–100 种物料。",
    "Please select 1–100 materials for each transfer.",
    "Vui lòng chọn 1–100 vật tư cho mỗi lần chuyển."
  ],
  "VALIDATION_TRANSFERS_46369DB2CA": [
    "调拨数量需为正数且最多 4 位小数。",
    "The transfer quantity needs to be a positive number with up to 4 decimal places.",
    "Số lượng chuyển cần phải là số dương có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_TRANSFERS_413EFF8527": [
    "调拨记录不存在或已损坏。",
    "The transfer record does not exist or is corrupt.",
    "Hồ sơ chuyển giao không tồn tại hoặc bị hỏng."
  ],
  "VALIDATION_TRANSFERS_C692E5E1E6": [
    "请在调出仓库撤销该调拨。",
    "Please cancel the transfer at the transfer warehouse.",
    "Vui lòng hủy việc chuyển khoản tại kho chuyển nhượng."
  ],
  "VALIDATION_TRANSFERS_C27E0B45B6": [
    "该调拨已撤销。",
    "The transfer has been revoked.",
    "Việc chuyển nhượng đã bị thu hồi."
  ],
  "VALIDATION_TRANSFERS_A4D1967BBB": [
    "调拨物料档案缺失，无法撤销。",
    "The transfer material file is missing and cannot be undone.",
    "Tệp vật tư chuyển bị thiếu và không thể hoàn tác."
  ],
  "VALIDATION_TRANSFERS_33D07B4A5D": [
    "{p0} 在{p1}的库存不足，无法撤销调拨。",
    "{p0} has insufficient inventory at {p1} and cannot cancel the transfer.",
    "{p0} không có đủ hàng tồn kho tại {p1} và không thể hủy quá trình chuyển."
  ],
  "VALIDATION_UNITS_F8D77EF614": [
    "请配置 1–100 个计量单位，每个单位为 1–100 字。",
    "Please configure 1–100 units of measure, each with 1–100 words.",
    "Vui lòng định cấu hình 1–100 đơn vị đo lường, mỗi đơn vị có 1–100 từ."
  ],
  "VALIDATION_UNITS_3296B98975": [
    "计量单位名称不能重复。",
    "Unit of measurement names cannot be repeated.",
    "Tên đơn vị đo lường không thể lặp lại."
  ],
  "VALIDATION_WAREHOUSES_295DDCAEBB": [
    "仓库不存在，请重新选择仓库。",
    "The warehouse does not exist, please select a new warehouse.",
    "Kho không tồn tại, vui lòng chọn kho mới."
  ],
  "VALIDATION_WAREHOUSES_3CE144CAEE": [
    "物料或单据编号无效。",
    "The item or document number is invalid.",
    "Số mục hoặc vật tư không hợp lệ."
  ],
  "VALIDATION_WAREHOUSES_B9FA456F87": [
    "模板不存在或无权访问。",
    "The template does not exist or you do not have access to it.",
    "Mẫu không tồn tại hoặc bạn không có quyền truy cập vào nó."
  ],
  "VALIDATION_WAREHOUSES_EA39A3036D": [
    "该分类不属于当前仓库。",
    "This category does not belong to the current warehouse.",
    "Danh mục này không thuộc về kho hiện tại."
  ],
  "VALIDATION_WAREHOUSES_F459B7E3FA": [
    "该物料、单据或模板不属于当前仓库。",
    "The material, document or template does not belong to the current warehouse.",
    "vật tư, vật tư hoặc mẫu không thuộc kho hiện tại."
  ],
  "VALIDATION_WAREHOUSES_6B7D65A92E": [
    "请选择是否复用当前仓库的分类和物料。",
    "Please choose whether to reuse the classification and materials of the current warehouse.",
    "Vui lòng chọn có sử dụng lại phân loại và vật liệu của kho hiện tại hay không."
  ],
  "VALIDATION_WAREHOUSES_DF4CC30562": [
    "仓库编号无效。",
    "The warehouse number is invalid.",
    "Số kho không hợp lệ."
  ],
  "VALIDATION_WAREHOUSES_28CF6324B9": [
    "主仓库是系统默认仓库，不能删除。",
    "The main warehouse is the system default warehouse and cannot be deleted.",
    "Kho chính là kho mặc định của hệ thống và không thể xóa được."
  ],
  "VALIDATION_WAREHOUSES_7F141D4BBA": [
    "仓库仍有库存，不能删除，请先清空所有物料库存。",
    "The warehouse still has inventory and cannot be deleted. Please clear all material inventories first.",
    "Kho vẫn còn hàng, không thể xóa được. Trước tiên hãy dọn sạch tất cả hàng tồn kho nguyên liệu."
  ],
  "VALIDATION_WAREHOUSES_2007619B37": [
    "仓库仍有验收单，不能删除。",
    "There are still acceptance documents in the warehouse and cannot be deleted.",
    "Trong kho vẫn còn văn bản nghiệm thu, không thể xóa được."
  ],
  "VALIDATION_WAREHOUSES_914BEB9290": [
    "仓库仍有生产单，不能删除，请保留生产历史。",
    "There are still production orders in the warehouse and cannot be deleted. Please keep the production history.",
    "Trong kho vẫn còn lệnh sản xuất, không thể xóa được. Hãy giữ lại lịch sử sản xuất."
  ],
  "VALIDATION_WAREHOUSES_DDC420DA10": [
    "仓库仍有品质模板及历史版本，不能删除。",
    "There are still quality templates and historical versions in the warehouse and cannot be deleted.",
    "Vẫn còn những mẫu chất lượng và phiên bản lịch sử trong kho và không thể xóa được."
  ],
  "VALIDATION_WAREHOUSES_1FAB3EBD26": [
    "请填写 1–60 字的仓库名称。",
    "Please enter a 1-60 word warehouse name.",
    "Vui lòng nhập tên kho từ 1-60 từ."
  ],
  "VALIDATION_WAREHOUSES_60AEA3427F": [
    "请选择有效的同步仓库。",
    "Please select a valid sync repository.",
    "Vui lòng chọn kho lưu trữ đồng bộ hóa hợp lệ."
  ],
  "VALIDATION_WAREHOUSES_5658B43B26": [
    "同步目标仓库不存在或与当前仓库相同。",
    "The synchronization target warehouse does not exist or is the same as the current warehouse.",
    "Kho mục tiêu đồng bộ hóa không tồn tại hoặc giống với kho hiện tại."
  ],
  "VALIDATION_WAREHOUSES_B7C24548D7": [
    "目标仓库已有同条码的独立物料，请先核对条码，未保存任何修改。",
    "The target warehouse already has independent materials with the same barcode. Please check the barcode first. No modifications have been saved.",
    "Kho mục tiêu đã có sẵn nguyên liệu độc lập có cùng mã vạch. Vui lòng kiểm tra mã vạch trước. Không có sửa đổi nào được lưu."
  ],
  "VALIDATION_WEBHOOK_TRANSPORT_2F9E567A61": [
    "请填写有效的 HTTPS Webhook 地址。",
    "Please fill in a valid HTTPS webhook address.",
    "Vui lòng điền địa chỉ webhook HTTPS hợp lệ."
  ],
  "VALIDATION_WEBHOOK_TRANSPORT_13DB77B348": [
    "Webhook 需为公网 HTTPS 地址，不支持账号密码、片段或本机／内网地址。",
    "Webhook needs to be a public HTTPS address, and does not support account passwords, fragments, or local/intranet addresses.",
    "Webhook cần phải là địa chỉ HTTPS công khai và không hỗ trợ mật khẩu tài khoản, phân đoạn hoặc địa chỉ mạng cục bộ/mạng nội bộ."
  ],
  "VALIDATION_BOM_EXPANSION_39F5FCBFDE": [
    "BOM计算比例过大，请简化配方。",
    "The BOM calculation ratio is too large, please simplify the formula.",
    "Tỷ lệ tính toán BOM quá lớn, hãy đơn giản hóa công thức."
  ],
  "VALIDATION_BOM_EXPANSION_317F725247": [
    "材料需求超出数量上限，请减少生产数量。",
    "Material demand exceeds the quantity limit, please reduce production quantity.",
    "Nhu cầu nguyên liệu vượt quá giới hạn số lượng, vui lòng giảm số lượng sản xuất."
  ],
  "VALIDATION_BOM_EXPANSION_7A6BAEC68A": [
    "BOM节点父子关联或排序无效。",
    "The parent-child association or ordering of BOM nodes is invalid.",
    "Liên kết cha-con hoặc thứ tự của các nút BOM không hợp lệ."
  ],
  "VALIDATION_BOM_EXPANSION_BA76EC61CA": [
    "最终领料物料不能超过 {p0} 种。",
    "The final material issue cannot exceed {p0} distinct materials.",
    "Danh sách lĩnh vật tư cuối cùng không được vượt quá {p0} loại vật tư."
  ],
  "VALIDATION_BOM_EXPANSION_2B8FAAB4F4": [
    "BOM循环引用：{p0}",
    "BOM circular reference: {p0}",
    "Tham chiếu vòng tròn BOM: {p0}"
  ],
  "VALIDATION_BOM_EXPANSION_07754C3558": [
    "BOM最多支持 {p0} 层。",
    "A BOM can contain up to {p0} levels.",
    "BOM hỗ trợ tối đa {p0} cấp."
  ],
  "VALIDATION_BOM_EXPANSION_DA2E4FAE00": [
    "{p0}：BOM已停用。",
    "{p0}: BOM has been deactivated.",
    "{p0}: BOM đã bị vô hiệu hóa."
  ],
  "VALIDATION_BOM_EXPANSION_B74402172F": [
    "{p0}：成品、材料或废料已停用。",
    "{p0}: Finished product, material, or scrap has been decommissioned.",
    "{p0}: Thành phẩm, vật liệu hoặc phế liệu đã ngừng hoạt động."
  ],
  "VALIDATION_BOM_EXPANSION_9259B0A0BD": [
    "{p0}：物料单位已变化，请核对配方并重新保存。",
    "{p0}: The material unit has changed, please check the formula and save it again.",
    "{p0}: Đơn vị nguyên liệu đã thay đổi, vui lòng kiểm tra lại công thức và lưu lại."
  ],
  "VALIDATION_BOM_EXPANSION_46BB509CE7": [
    "{p0}：下级配方包含废料规则，本期请改为领用本物料并单独生产。",
    "{p0}: The child recipe includes scrap rules. For now, issue this material from stock and produce it separately.",
    "{p0}: Công thức cấp dưới có quy tắc phế liệu. Hiện tại, hãy lĩnh vật tư này từ kho và sản xuất riêng."
  ],
  "VALIDATION_BOM_EXPANSION_5560BB7C84": [
    "展开材料节点不能超过 {p0} 个。",
    "The number of expanded material nodes cannot exceed {p0}.",
    "Số lượng nút vật liệu mở rộng không thể vượt quá {p0}."
  ],
  "VALIDATION_BOM_EXPANSION_AE1F901544": [
    "{p0} → {p1}：请选择当前物料在当前仓库的下级配方。",
    "{p0} → {p1}: Please select the subordinate formula of the current material in the current warehouse.",
    "{p0} → {p1}: Vui lòng chọn công thức phụ của nguyên liệu hiện tại trong kho hiện tại."
  ],
  "VALIDATION_BOM_EXPANSION_1C5C581E92": [
    "{p0}：最终领料不能包含本单成品。",
    "{p0}: The final picking cannot include the finished product of this order.",
    "{p0}: Lần lấy hàng cuối cùng không thể bao gồm thành phẩm của đơn hàng này."
  ],
  "VALIDATION_BOM_EXPANSION_B33455CEB1": [
    "根BOM废料不能与展开结构中的材料或半成品相同。",
    "The root BOM scrap cannot be the same as the material or semi-finished product in the unfolded structure.",
    "Phế liệu BOM gốc không thể giống với vật liệu hoặc bán thành phẩm ở cấu trúc chưa được gấp."
  ],
  "VALIDATION_BOM_EXPANSION_88B78B58E9": [
    "按投入比例的废料来源必须直接领用，且不能同时出现在其他展开路径。",
    "The scrap source proportional to the input must be taken directly and cannot appear in other expansion paths at the same time.",
    "Nguồn phế liệu tỷ lệ thuận với đầu vào phải được lấy trực tiếp và không được xuất hiện đồng thời ở các đường dẫn mở rộng khác."
  ],
  "VALIDATION_BOM_EXPANSION_A29EA9325E": [
    "生产配方节点数量无效。",
    "The number of production recipe nodes is invalid.",
    "Số lượng nút công thức sản xuất không hợp lệ."
  ],
  "VALIDATION_BOM_EXPANSION_1A6D531C2C": [
    "生产配方节点字段或路径无效。",
    "The production recipe node field or path is invalid.",
    "Trường hoặc đường dẫn nút công thức sản xuất không hợp lệ."
  ],
  "VALIDATION_BOM_EXPANSION_56F99FA7C1": [
    "生产物料取整属性无效。",
    "The production material rounding attribute is invalid.",
    "Thuộc tính làm tròn nguyên liệu sản xuất không hợp lệ."
  ],
  "VALIDATION_BOM_EXPANSION_CB5858AF4E": [
    "同一生产物料的节点快照不一致。",
    "Node snapshots of the same production material are inconsistent.",
    "Ảnh chụp nhanh nút của cùng một nguyên liệu sản xuất không nhất quán."
  ],
  "VALIDATION_BOM_EXPANSION_EEFBCCBE56": [
    "生产配方子节点关联无效。",
    "The production recipe sub-node association is invalid.",
    "Liên kết nút phụ công thức sản xuất không hợp lệ."
  ],
  "VALIDATION_BOM_EXPANSION_F9D2967F90": [
    "生产配方节点来源或排序不一致。",
    "The source or order of production recipe nodes is inconsistent.",
    "Nguồn hoặc thứ tự của các nút công thức sản xuất không nhất quán."
  ],
  "VALIDATION_BOM_EXPANSION_D2E733D1C7": [
    "同一生产配方的重复引用内容不一致。",
    "Repeated references to the same production recipe have inconsistent content.",
    "Các tài liệu tham khảo lặp đi lặp lại về cùng một công thức sản xuất có nội dung không nhất quán."
  ],
  "VALIDATION_BOM_EXPANSION_604B26B6D7": [
    "生产根配方快照不一致。",
    "Production root recipe snapshot is inconsistent.",
    "Ảnh chụp nhanh công thức gốc sản xuất không nhất quán."
  ],
  "VALIDATION_BOM_EXPANSION_87AD2FBAEA": [
    "生产配方节点结构或内容不一致。",
    "The structure or content of the production recipe node is inconsistent.",
    "Cấu trúc hoặc nội dung của nút công thức sản xuất không nhất quán."
  ],
  "VALIDATION_BOM_89D9BA9ED2": [
    "请选择有效的标准损耗计算方式（内扣法或外包法）。",
    "Please select a valid standard loss calculation method (internal deduction method or outsourcing method).",
    "Vui lòng chọn phương pháp tính tổn thất tiêu chuẩn hợp lệ (phương pháp khấu trừ nội bộ hoặc phương pháp gia công)."
  ],
  "VALIDATION_BOM_AD6BE21597": [
    "标准损耗率需为 0（含）至 100（不含）的百分数，最多 6 位小数。",
    "The standard loss rate needs to be a percentage from 0 (inclusive) to 100 (exclusive), with up to 6 decimal places.",
    "Tỷ lệ tổn thất tiêu chuẩn phải là tỷ lệ phần trăm từ 0 (bao gồm) đến 100 (không bao gồm), có tối đa 6 chữ số thập phân."
  ],
  "VALIDATION_BOM_99EA2033B1": [
    "材料用量分数的分子、分母需为 1–{p0} 的整数，例如 1/40。",
    "The numerator and denominator of the material dosage fraction must be integers in the range 1–{p0}, such as 1/40.",
    "Tử số và mẫu số của phần liều lượng vật liệu phải là số nguyên trong khoảng 1–{p0}, chẳng hạn như 1/40."
  ],
  "VALIDATION_BOM_F37B4853DD": [
    "材料用量需为正数且最多 4 位小数。",
    "Material amounts need to be positive numbers with up to 4 decimal places.",
    "Số lượng vật chất cần phải là số dương có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_BOM_EA033889E8": [
    "材料用量与分数不一致，请重新填写用量。",
    "The material usage is inconsistent with the score, please fill in the usage again.",
    "Việc sử dụng vật liệu không phù hợp với điểm số, vui lòng điền lại cách sử dụng."
  ],
  "VALIDATION_BOM_E035EC1E1D": [
    "请选择成品物料。",
    "Please select the finished product material.",
    "Vui lòng chọn chất liệu thành phẩm."
  ],
  "VALIDATION_BOM_734791EEC3": [
    "请填写 1–100 字的BOM名称。",
    "Please fill in the BOM name in 1-100 words.",
    "Vui lòng điền tên BOM trong 1-100 từ."
  ],
  "VALIDATION_BOM_421D079014": [
    "基准产量需为正数，最多 4 位小数。",
    "Baseline yield needs to be a positive number with up to 4 decimal places.",
    "Lợi suất cơ bản cần phải là số dương có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_BOM_9313323A74": [
    "单位、备注或启用状态无效。",
    "Invalid unit, comment, or enabled status.",
    "Đơn vị, nhận xét hoặc trạng thái bật không hợp lệ."
  ],
  "VALIDATION_BOM_A05D59DBAD": [
    "请添加 1–{p0} 种材料。",
    "Add 1–{p0} materials.",
    "Thêm từ 1 đến {p0} loại vật tư."
  ],
  "VALIDATION_BOM_4FA4CB8074": [
    "材料、用量、单位或备注无效，用量需为正数且最多 4 位小数。",
    "Invalid material, dosage, unit or remarks, dosage needs to be a positive number with up to 4 decimal places.",
    "Nguyên liệu, liều lượng, đơn vị hoặc nhận xét, liều lượng không hợp lệ phải là số dương có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_BOM_B971515F48": [
    "请选择有效的用料方式；展开时必须指定下级配方，直接领用时不能指定下级配方。",
    "Please select a valid material usage method; you must specify a lower-level formula when expanding, and you cannot specify a lower-level formula when you use it directly.",
    "Vui lòng chọn phương pháp sử dụng vật liệu hợp lệ; bạn phải chỉ định công thức cấp thấp hơn khi mở rộng và bạn không thể chỉ định công thức cấp thấp hơn khi sử dụng trực tiếp."
  ],
  "VALIDATION_BOM_926C4C87E7": [
    "成品不能作为自身的材料。",
    "The finished product cannot be its own material.",
    "Sản phẩm hoàn thiện không thể là nguyên liệu của chính nó."
  ],
  "VALIDATION_BOM_72417E6263": [
    "同一材料不能重复添加，请合并用量。",
    "The same material cannot be added repeatedly, please combine the dosage.",
    "Không thể thêm cùng một nguyên liệu nhiều lần, vui lòng kết hợp liều lượng."
  ],
  "VALIDATION_BOM_A1E9FADD41": [
    "生产数量和用量需为正数，最多 4 位小数。",
    "Production quantity and usage must be positive numbers with up to 4 decimal places.",
    "Số lượng sản xuất và sử dụng phải là số dương có tới 4 chữ số thập phân."
  ],
  "VALIDATION_INSPECTION_E0D800F1DA": [
    "请填写有效的校验日期。",
    "Please fill in a valid verification date.",
    "Vui lòng điền ngày xác minh hợp lệ."
  ],
  "VALIDATION_INSPECTION_F337E07361": [
    "校验周期需为 1–999 的整数，可选择天、月或年；留空表示手动设置日期。",
    "The verification period needs to be an integer from 1 to 999, and you can choose days, months, or years; leaving it blank means setting the date manually.",
    "Khoảng thời gian xác minh cần phải là số nguyên từ 1 đến 999 và bạn có thể chọn ngày, tháng hoặc năm; để trống có nghĩa là cài đặt ngày theo cách thủ công."
  ],
  "VALIDATION_INSPECTION_BEF101B827": [
    "设置校验周期时，请同时填写校验日期。",
    "When setting the calibration cycle, please also fill in the calibration date.",
    "Khi cài đặt chu trình hiệu chuẩn, vui lòng điền ngày hiệu chuẩn."
  ],
  "VALIDATION_INSPECTION_AD0CBEA432": [
    "下次校验日期超出支持范围，请调整周期。",
    "The next verification date is outside the supported range, please adjust the cycle.",
    "Ngày xác minh tiếp theo nằm ngoài phạm vi được hỗ trợ, vui lòng điều chỉnh chu kỳ."
  ],
  "VALIDATION_INSPECTION_CFD896EC4A": [
    "请填写不晚于今天的实际校验日期。",
    "Please enter the actual verification date no later than today.",
    "Vui lòng nhập ngày xác minh thực tế không muộn hơn ngày hôm nay."
  ],
  "VALIDATION_INSPECTION_6839E41411": [
    "请填写晚于实际校验日期的下次校验日期。",
    "Please fill in the next verification date which is later than the actual verification date.",
    "Vui lòng điền ngày xác minh tiếp theo muộn hơn ngày xác minh thực tế."
  ],
  "VALIDATION_PRODUCT_PRODUCTION_TYPE_068335A6E9": [
    "生产类型只能选择成品、半成品、原料，或留空。",
    "The production type can only select finished products, semi-finished products, raw materials, or leave it blank.",
    "Loại hình sản xuất chỉ được chọn thành phẩm, bán thành phẩm, nguyên liệu thô hoặc để trống."
  ],
  "VALIDATION_PRODUCTION_BATCHES_7A1BCE81DD": [
    "生产批次数量无效。",
    "The production batch quantity is invalid.",
    "Số lượng lô sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_BATCHES_4EF294EA12": [
    "生产累计数量超出上限，请拆分生产单。",
    "The cumulative production quantity exceeds the upper limit, please split the production order.",
    "Số lượng sản xuất tích lũy vượt quá giới hạn trên, vui lòng chia nhỏ lệnh sản xuất."
  ],
  "VALIDATION_PRODUCTION_BATCHES_09220BEED3": [
    "生产累计成本超出范围，请拆分生产单。",
    "The cumulative production cost is out of range, please split the production order.",
    "Chi phí sản xuất cộng dồn nằm ngoài phạm vi, vui lòng chia nhỏ lệnh sản xuất."
  ],
  "VALIDATION_PRODUCTION_LINK_9B76DDD8BC": [
    "生产登记二维码的单据或仓库编号无效。",
    "The document or warehouse number of the production registration QR code is invalid.",
    "Số tài liệu hoặc số kho của mã QR đăng ký sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_LINK_023EE71A7E": [
    "生产登记地址无效。",
    "The production registration address is invalid.",
    "Địa chỉ đăng ký sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_LINK_1386F6117E": [
    "生产登记地址必须是无账号密码的 HTTP(S) 网站地址。",
    "The production registration address must be an HTTP(S) website address without an account password.",
    "Địa chỉ đăng ký sản xuất phải là địa chỉ trang web HTTP(S) không có mật khẩu tài khoản."
  ],
  "VALIDATION_PRODUCTION_LINK_A4312ED947": [
    "生产登记二维码的单号无效。",
    "The order number of the production registration QR code is invalid.",
    "Số đơn hàng của mã QR đăng ký sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_LINK_FF41299504": [
    "生产登记二维码的系统标识无效。",
    "The system identification of the production registration QR code is invalid.",
    "Việc nhận dạng hệ thống của mã QR đăng ký sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_LINK_2FD295A8F8": [
    "请扫描或粘贴完整的生产登记二维码链接。",
    "Please scan or paste the complete production registration QR code link.",
    "Vui lòng quét hoặc dán liên kết mã QR đăng ký sản xuất hoàn chỉnh."
  ],
  "VALIDATION_PRODUCTION_LINK_7DD2FDA415": [
    "这不是有效的生产登记二维码地址。",
    "This is not a valid production registration QR code address.",
    "Đây không phải là địa chỉ mã QR đăng ký sản xuất hợp lệ."
  ],
  "VALIDATION_PRODUCTION_LINK_6835A55180": [
    "二维码的网站地址与当前地址不同，请打开对应网站后重试。",
    "The website address of the QR code is different from the current address. Please open the corresponding website and try again.",
    "Địa chỉ trang web của mã QR khác với địa chỉ hiện tại. Vui lòng mở trang web tương ứng và thử lại."
  ],
  "VALIDATION_PRODUCTION_LINK_91EFFE2E3B": [
    "生产登记二维码字段缺失或重复。",
    "The production registration QR code field is missing or duplicated.",
    "Trường mã QR đăng ký sản xuất bị thiếu hoặc trùng lặp."
  ],
  "VALIDATION_PRODUCTION_LINK_4B0F386932": [
    "生产登记二维码仓库编号无效。",
    "The production registration QR code warehouse number is invalid.",
    "Số kho mã QR đăng ký sản xuất không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_LINK_C01053095B": [
    "生产登记二维码仓库编号不一致。",
    "The production registration QR code warehouse number is inconsistent.",
    "Số kho mã QR đăng ký sản xuất không nhất quán."
  ],
  "VALIDATION_PRODUCTION_LINK_C0689BE525": [
    "二维码来自其他系统或已恢复前的数据，请重新导出生产单。",
    "The QR code comes from other systems or the data has been restored. Please re-export the production order.",
    "Mã QR đến từ hệ thống khác hoặc dữ liệu đã được khôi phục. Vui lòng xuất lại lệnh sản xuất."
  ],
  "VALIDATION_PRODUCTION_CF48189A10": [
    "生产配方缺少该领料项。",
    "The production recipe is missing this picking item.",
    "Công thức sản xuất thiếu vật phẩm hái này."
  ],
  "VALIDATION_PRODUCTION_DDB10134D4": [
    "计划产量需为正数，最多 4 位小数。",
    "Planned output needs to be a positive number with up to 4 decimal places.",
    "Sản lượng theo kế hoạch cần phải là số dương có tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_PRODUCTION_8E326F0665": [
    "生产备注最多 500 字。",
    "Production notes can be up to 500 words.",
    "Ghi chú sản xuất có thể lên tới 500 từ."
  ],
  "VALIDATION_PRODUCTION_0BE38702E5": [
    "合格成品数量需为正数，最多 4 位小数。",
    "The quantity of qualified finished products must be a positive number with up to 4 decimal places.",
    "Số lượng thành phẩm đạt tiêu chuẩn phải là số dương tối đa 4 chữ số thập phân."
  ],
  "VALIDATION_PRODUCTION_AFDFAF953B": [
    "请明确本批入库后是否结束生产。",
    "Please clarify whether production will end after this batch is put into storage.",
    "Vui lòng làm rõ liệu việc sản xuất có kết thúc sau khi lô hàng này được đưa vào kho hay không."
  ],
  "VALIDATION_PRODUCTION_444F883E30": [
    "本批备注最多 500 字。",
    "Notes for this batch can be up to 500 words.",
    "Ghi chú cho đợt này có thể lên tới 500 từ."
  ],
  "VALIDATION_PRODUCTION_C6CB918F74": [
    "请核对全部材料的实际耗料。",
    "Please check the actual consumption of all materials.",
    "Vui lòng kiểm tra mức tiêu thụ thực tế của tất cả các vật liệu."
  ],
  "VALIDATION_PRODUCTION_22B99F8899": [
    "实际耗料需为非负数且最多 4 位小数，材料不能重复或增删。",
    "The actual consumables must be a non-negative number with up to 4 decimal places. Materials cannot be repeated, added or deleted.",
    "Vật tư tiêu hao thực tế phải là số không âm có tối đa 4 chữ số thập phân. vật tư không thể được lặp lại, thêm hoặc xóa."
  ],
  "VALIDATION_PRODUCTION_FA0C2CC667": [
    "每种材料的耗料差异原因最多 500 字。",
    "The reason for the difference in consumption of each material can be up to 500 words.",
    "Lý do cho sự khác biệt về mức tiêu thụ của từng vật tư có thể lên tới 500 từ."
  ],
  "VALIDATION_PRODUCTION_CCBAAA4DFE": [
    "至少一种材料的实际耗料需大于零。",
    "The actual consumption of at least one material needs to be greater than zero.",
    "Mức tiêu thụ thực tế của ít nhất một vật liệu cần phải lớn hơn 0."
  ],
  "VALIDATION_PRODUCTION_A5C8ABA612": [
    "实际耗料无效。",
    "Actual consumption is invalid.",
    "Mức tiêu thụ thực tế không hợp lệ."
  ],
  "VALIDATION_PRODUCTION_0B0B8BBA8B": [
    "标准耗料无效。",
    "Standard consumables are invalid.",
    "Vật tư tiêu hao tiêu chuẩn không hợp lệ."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_4607AAB6E4": [
    "手动修正最多支持 1000 个单元格。",
    "Manual correction is supported for up to 1000 cells.",
    "Hỗ trợ chỉnh sửa thủ công cho tối đa 1000 ô."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_602C14B96D": [
    "手动修正的工作表、单元格或内容无效。",
    "Manually corrected sheets, cells, or contents are invalid.",
    "Các trang tính, ô hoặc nội dung được sửa thủ công đều không hợp lệ."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_8D70DF5271": [
    "手动修正只能用于所选数据工作表。",
    "Manual corrections are only available on selected data sheets.",
    "Chỉnh sửa thủ công chỉ có sẵn trên các bảng dữ liệu đã chọn."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_9B18BAA5B1": [
    "手动修正单元格地址无效。",
    "Manually correcting the cell address is invalid.",
    "Việc sửa địa chỉ ô theo cách thủ công là không hợp lệ."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_84837C3069": [
    "手动修正单元格超出工作表范围。",
    "Manually correct the cells beyond the worksheet range.",
    "Sửa thủ công các ô nằm ngoài phạm vi trang tính."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_B4C34FB50D": [
    "请修正合并单元格左上角的内容。",
    "Please correct the contents of the upper left corner of the merged cells.",
    "Vui lòng sửa lại nội dung ở góc trên bên trái của các ô đã hợp nhất."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_28FF8DCA49": [
    "同一单元格不能重复提交手动修正。",
    "Manual correction cannot be submitted repeatedly for the same cell.",
    "Không thể gửi chỉnh sửa thủ công nhiều lần cho cùng một ô."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_56A2C7EAB8": [
    "缺少工作表“{p0}”，请重新选择需要解析的数据工作表。",
    "The worksheet \"{p0}\" is missing, please reselect the data worksheet that needs to be parsed.",
    "Thiếu bảng tính \"{p0}\", vui lòng chọn lại bảng tính dữ liệu cần phân tích cú pháp."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_053FA37CF0": [
    "字段标题或对象属性与模板不一致，请勿移动或修改这些单元格。",
    "Field titles or object properties are inconsistent with the template, do not move or modify these cells.",
    "Tiêu đề trường hoặc thuộc tính đối tượng không nhất quán với mẫu, không di chuyển hoặc sửa đổi các ô này."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_EAB87E4FBC": [
    "配置区域的合并单元格与模板不一致，请使用所选版本的原始 Excel。",
    "The merged cells of the configuration range are inconsistent with the template, please use the original Excel version of the selected version.",
    "Các ô đã hợp nhất của phạm vi cấu hình không nhất quán với mẫu, vui lòng sử dụng phiên bản Excel gốc của phiên bản đã chọn."
  ],
  "VALIDATION_QUALITY_ACCEPTANCE_40BE316883": [
    "请选择 1–20 个不重复的数据工作表。",
    "Please select 1–20 unique data worksheets.",
    "Vui lòng chọn 1–20 bảng tính dữ liệu duy nhất."
  ],
  "VALIDATION_QUALITY_CHARTS_91415CEDB8": [
    "饼图需要非负数值；当前数据包含负数或无效数值，请查看统计数据或选择其他图表样式。",
    "Pie charts require non-negative values; the current data contains negative or invalid values, please view the statistics or choose a different chart style.",
    "Biểu đồ hình tròn yêu cầu giá trị không âm; dữ liệu hiện tại chứa các giá trị âm hoặc không hợp lệ, vui lòng xem số liệu thống kê hoặc chọn kiểu biểu đồ khác."
  ],
  "VALIDATION_QUALITY_CHARTS_3D19EC9D7C": [
    "当前统计值均为 0，暂无可展示的占比。",
    "The current statistical values are all 0, and there is currently no proportion to display.",
    "Các giá trị thống kê hiện tại đều bằng 0 và hiện tại không có tỷ lệ nào để hiển thị."
  ],
  "VALIDATION_QUALITY_CHARTS_9B507D8A3D": [
    "请选择有效的图表分类和图表类型。",
    "Please select a valid chart category and chart type.",
    "Vui lòng chọn danh mục và loại biểu đồ hợp lệ."
  ],
  "VALIDATION_QUALITY_CHARTS_E4F1B6EA2D": [
    "图表的对象数据来源不存在。",
    "The object data source for the chart does not exist.",
    "Nguồn dữ liệu đối tượng cho biểu đồ không tồn tại."
  ],
  "VALIDATION_QUALITY_CHARTS_BCAF019E65": [
    "{p0}字段不存在或数据类型不适用。",
    "The {p0} field does not exist or the data type is not applicable.",
    "Trường {p0} không tồn tại hoặc loại dữ liệu không áp dụng được."
  ],
  "VALIDATION_QUALITY_CHARTS_21F6A05A44": [
    "日期汇总方式无效。",
    "Invalid date aggregation method.",
    "Phương pháp tổng hợp ngày không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHARTS_52BBFA0504": [
    "物料图表已限定当前物料，无需再次按物料分组。",
    "The material chart has been limited to the current material and there is no need to group by material again.",
    "Biểu đồ vật liệu đã được giới hạn ở vật liệu hiện tại và không cần phải nhóm lại theo vật liệu."
  ],
  "VALIDATION_QUALITY_CHARTS_4C0C7A6795": [
    "统计方式无效。",
    "The statistical method is invalid.",
    "Phương pháp thống kê không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHARTS_2A545DBF83": [
    "{p0}无效。",
    "{p0} is invalid.",
    "{p0} không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHARTS_17F848CEC4": [
    "此图表未配置日期筛选字段。",
    "This chart does not have a date filter field configured.",
    "Biểu đồ này không có trường bộ lọc ngày được định cấu hình."
  ],
  "VALIDATION_QUALITY_CHARTS_1A0FC6CE07": [
    "请选择用于预览的物料。",
    "Please select an item for preview.",
    "Vui lòng chọn một mục để xem trước."
  ],
  "VALIDATION_QUALITY_CHARTS_6B361C85F9": [
    "图表数据超过 1000 个分组或 20000 条记录，请缩小时间或验收单范围。",
    "The chart data exceeds 1,000 groups or 20,000 records, please narrow the time or acceptance order range.",
    "Dữ liệu biểu đồ vượt quá 1.000 nhóm hoặc 20.000 bản ghi, vui lòng thu hẹp phạm vi thời gian hoặc lệnh chấp nhận."
  ],
  "VALIDATION_QUALITY_CHARTS_9209559EDE": [
    "统计结果超出数值范围，请缩小统计范围。",
    "The statistical results exceed the numerical range, please narrow the statistical range.",
    "Kết quả thống kê vượt quá phạm vi số, vui lòng thu hẹp phạm vi thống kê."
  ],
  "VALIDATION_QUALITY_CHECKS_C77934BEC7": [
    "测量值须按指定分隔符填写完整数字，不能含空项或其他文字。",
    "The measurement value must be filled in with the specified delimiter and must not contain blanks or other text.",
    "Giá trị đo phải được điền bằng dấu phân cách được chỉ định và không được chứa khoảng trống hoặc văn bản khác."
  ],
  "VALIDATION_QUALITY_CHECKS_E8C67064AE": [
    "测量值超出支持范围。",
    "The measured value is outside the supported range.",
    "Giá trị đo nằm ngoài phạm vi được hỗ trợ."
  ],
  "VALIDATION_QUALITY_CHECKS_732FACFE63": [
    "最多配置 100 条核对规则。",
    "Configure up to 100 verification rules.",
    "Định cấu hình tối đa 100 quy tắc xác minh."
  ],
  "VALIDATION_QUALITY_CHECKS_329C17F1E3": [
    "核对规则引用的字段不存在。",
    "The field referenced by the reconciliation rule does not exist.",
    "Trường được tham chiếu bởi quy tắc đối chiếu không tồn tại."
  ],
  "VALIDATION_QUALITY_CHECKS_C2444C97FE": [
    "核对规则引用的对象属性不存在。",
    "The object property referenced by the reconciliation rule does not exist.",
    "Thuộc tính đối tượng được tham chiếu bởi quy tắc đối chiếu không tồn tại."
  ],
  "VALIDATION_QUALITY_CHECKS_46E8C496F0": [
    "核对项目匹配属性无效。",
    "Check item matching attribute is invalid.",
    "Kiểm tra thuộc tính phù hợp với mục không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHECKS_6EAE259A40": [
    "普通字段不能配置对象属性或项目匹配。",
    "Ordinary fields cannot be configured with object properties or item matching.",
    "Các trường thông thường không thể được cấu hình bằng các thuộc tính đối tượng hoặc khớp mục."
  ],
  "VALIDATION_QUALITY_CHECKS_B1F3721A4A": [
    "核对规则类型或 ID 无效。",
    "Invalid reconciliation rule type or ID.",
    "Loại hoặc ID quy tắc đối chiếu không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHECKS_AFB9EDC430": [
    "测量公差的模式或限值数量无效。",
    "Invalid mode or limit number for measuring tolerance.",
    "Chế độ hoặc số giới hạn không hợp lệ để đo dung sai."
  ],
  "VALIDATION_QUALITY_CHECKS_431C776A4E": [
    "公差上下限无效。",
    "The upper and lower tolerance limits are invalid.",
    "Giới hạn dung sai trên và dưới không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHECKS_AD2F7296CF": [
    "公差边界类型无效。",
    "Tolerance boundary type is invalid.",
    "Loại ranh giới dung sai không hợp lệ."
  ],
  "VALIDATION_QUALITY_CHECKS_A9AAC23CA1": [
    "公差区间不能为空。",
    "Tolerance interval cannot be empty.",
    "Khoảng dung sai không được để trống."
  ],
  "VALIDATION_QUALITY_CHECKS_9805CEE463": [
    "缺陷合计来源必须是对象属性。",
    "The defect total source must be an object property.",
    "Tổng nguồn lỗi phải là một thuộc tính đối tượng."
  ],
  "VALIDATION_QUALITY_CHECKS_FC0874CCB3": [
    "合计目标或空白处理方式无效。",
    "Invalid total target or blank handling.",
    "Tổng mục tiêu không hợp lệ hoặc xử lý trống."
  ],
  "VALIDATION_QUALITY_CHECKS_68A7AB8F00": [
    "缺陷合计目标须为普通字段。",
    "The defect total target must be a normal field.",
    "Mục tiêu tổng số lỗi phải là một trường bình thường."
  ],
  "VALIDATION_QUALITY_CHECKS_7495762927": [
    "每个模板最多配置一条最终判定核对规则。",
    "Each template can be configured with at most one final judgment verification rule.",
    "Mỗi mẫu có thể được định cấu hình với tối đa một quy tắc xác minh phán đoán cuối cùng."
  ],
  "VALIDATION_QUALITY_CHECKS_1A70A9FCD6": [
    "最终判定须为普通字段，检验结果与单项判定须来自同一对象。",
    "The final judgment must be a common field, and the test results and individual judgments must come from the same object.",
    "Phán quyết cuối cùng phải là lĩnh vực chung, kết quả kiểm tra và phán đoán riêng lẻ phải xuất phát từ cùng một đối tượng."
  ],
  "VALIDATION_QUALITY_CHECKS_E6B9186421": [
    "请配置合格及不合格文字。",
    "Please configure qualified and unqualified text.",
    "Vui lòng định cấu hình văn bản đủ tiêu chuẩn và không đủ tiêu chuẩn."
  ],
  "VALIDATION_QUALITY_CHECKS_69ED1106FE": [
    "合格与不合格文字不能重复。",
    "Qualified and unqualified words cannot be repeated.",
    "Những từ đủ tiêu chuẩn và không đủ tiêu chuẩn không thể được lặp lại."
  ],
  "VALIDATION_QUALITY_DESIGNER_5CEA8CEE9D": [
    "所选区域超出当前表格。",
    "The selected range exceeds the current table.",
    "Phạm vi đã chọn vượt quá bảng hiện tại."
  ],
  "VALIDATION_QUALITY_DESIGNER_4DDE950385": [
    "格式设置无效。",
    "Invalid formatting.",
    "Định dạng không hợp lệ."
  ],
  "VALIDATION_QUALITY_DESIGNER_25B6D53503": [
    "字号需要为 6–96。",
    "Font size needs to be 6–96.",
    "Cỡ chữ cần phải là 6–96."
  ],
  "VALIDATION_QUALITY_DESIGNER_E7F9F06ABE": [
    "工作表不存在。",
    "The worksheet does not exist.",
    "Bảng tính không tồn tại."
  ],
  "VALIDATION_QUALITY_DESIGNER_34A3E01178": [
    "含公式的工作簿暂不支持在线重命名工作表，请保留原名称。",
    "Workbooks containing formulas do not currently support online renaming of worksheets, please keep the original name.",
    "Sổ làm việc chứa công thức hiện không hỗ trợ đổi tên bảng tính trực tuyến, vui lòng giữ nguyên tên gốc."
  ],
  "VALIDATION_QUALITY_DESIGNER_FEEE18F3B8": [
    "工作表名称无效或重复（最多 31 字，不能含 / \\ * ? : [ ]）。",
    "Invalid or duplicate worksheet name (maximum 31 characters, cannot contain / \\ * ? : [ ]).",
    "Tên bảng tính không hợp lệ hoặc trùng lặp (tối đa 31 ký tự, không được chứa / \\ * ? : [ ])."
  ],
  "VALIDATION_QUALITY_DESIGNER_1EEAD4AA2C": [
    "表格范围过大，最多 1997 行、98 列、50000 格（含预览边缘）。",
    "The table range is too large, with a maximum of 1,997 rows, 98 columns, and 50,000 cells (including preview edges).",
    "Phạm vi bảng quá lớn, tối đa 1.997 hàng, 98 cột và 50.000 ô (bao gồm cả các cạnh xem trước)."
  ],
  "VALIDATION_QUALITY_DESIGNER_1B36A5A04F": [
    "缩小范围会移除内容或合并单元格，请先清空内容并取消对应合并。",
    "Reducing the range will remove content or merge cells. Please clear the content and cancel the corresponding merge first.",
    "Việc giảm phạm vi sẽ xóa nội dung hoặc hợp nhất các ô. Vui lòng xóa nội dung và hủy hợp nhất tương ứng trước."
  ],
  "VALIDATION_QUALITY_DESIGNER_D79409C3CD": [
    "请选择至少两个单元格再合并。",
    "Please select at least two cells before merging.",
    "Vui lòng chọn ít nhất hai ô trước khi hợp nhất."
  ],
  "VALIDATION_QUALITY_DESIGNER_AE4CF8513C": [
    "合并区域中有其他内容，请仅保留左上角内容后再合并。",
    "There is other content in the merged area, please keep only the content in the upper left corner before merging.",
    "Có nội dung khác trong khu vực được hợp nhất, vui lòng chỉ giữ lại nội dung ở góc trên bên trái trước khi hợp nhất."
  ],
  "VALIDATION_QUALITY_DESIGNER_795EEE8BE8": [
    "行高需要为 {p1}–{p2} 像素。",
    "Row height must be {p1}–{p2} pixels.",
    "Chiều cao hàng phải từ {p1} đến {p2} pixel."
  ],
  "VALIDATION_QUALITY_DESIGNER_0EEEFE04A7": [
    "列宽需要为 {p1}–{p2} 像素。",
    "Column width must be {p1}–{p2} pixels.",
    "Độ rộng cột phải từ {p1} đến {p2} pixel."
  ],
  "VALIDATION_QUALITY_DESIGNER_1DEFF74E18": [
    "{p0}需要为 {p1}–{p2} 像素。",
    "{p0} needs to be {p1}–{p2} pixels.",
    "{p0} cần phải là pixel {p1}–{p2}."
  ],
  "VALIDATION_QUALITY_DESIGNER_1F391C9B72": [
    "单元格内容无效或超过 10000 字。",
    "The cell content is invalid or exceeds 10,000 words.",
    "Nội dung ô không hợp lệ hoặc vượt quá 10.000 từ."
  ],
  "VALIDATION_QUALITY_DESIGNER_EE8591D273": [
    "边框设置无效。",
    "Invalid border setting.",
    "Cài đặt đường viền không hợp lệ."
  ],
  "VALIDATION_QUALITY_DESIGNER_331306E444": [
    "不支持的表格操作。",
    "Unsupported table operation.",
    "Hoạt động bảng không được hỗ trợ."
  ],
  "VALIDATION_QUALITY_DESIGNER_1E3AD23D76": [
    "编辑操作过多，请先保存后继续。",
    "There are too many editing operations, please save before continuing.",
    "Có quá nhiều thao tác chỉnh sửa, vui lòng lưu lại trước khi tiếp tục."
  ],
  "VALIDATION_QUALITY_DESIGNER_EA33A72786": [
    "生成的模板超过 10 MB。",
    "The generated template exceeds 10 MB.",
    "Mẫu được tạo vượt quá 10 MB."
  ],
  "VALIDATION_QUALITY_ONLINE_77DFCF1DB6": [
    "模板工作表不存在。",
    "The template sheet does not exist.",
    "Bảng mẫu không tồn tại."
  ],
  "VALIDATION_QUALITY_ONLINE_47AE17DD10": [
    "填写区域 {p0} 与标题或合并边界重叠，请先调整模板配置。",
    "The fill-in area {p0} overlaps with the title or merge boundary, please adjust the template configuration first.",
    "Vùng điền {p0} trùng với tiêu đề hoặc ranh giới hợp nhất, vui lòng điều chỉnh cấu hình mẫu trước."
  ],
  "VALIDATION_QUALITY_ONLINE_9DE148CDEF": [
    "填写内容包含无效单元格或内容过长。",
    "The filled-in content contains invalid cells or the content is too long.",
    "Nội dung điền có chứa các ô không hợp lệ hoặc nội dung quá dài."
  ],
  "VALIDATION_QUALITY_ONLINE_C8BB057B18": [
    "模板原文件缺少配置的工作表。",
    "The original template file is missing a configured worksheet.",
    "Tệp mẫu ban đầu thiếu bảng tính được định cấu hình."
  ],
  "VALIDATION_QUALITY_ONLINE_1B76CDE4D4": [
    "生成的 Excel 超过 10 MB，请减少填写内容。",
    "The generated Excel exceeds 10 MB, please fill in less content.",
    "Excel tạo ra vượt quá 10 MB, vui lòng điền ít nội dung hơn."
  ],
  "VALIDATION_QUALITY_REGEX_16FF280A58": [
    "正则表达式最多 1000 个字符。",
    "Regular expressions can be up to 1000 characters.",
    "Biểu thức chính quy có thể dài tới 1000 ký tự."
  ],
  "VALIDATION_QUALITY_REGEX_A8861A81C0": [
    "正则替换内容最多 2000 个字符。",
    "Regular replacement content can be up to 2000 characters.",
    "Nội dung thay thế thông thường có thể lên tới 2000 ký tự."
  ],
  "VALIDATION_QUALITY_REGEX_CE656FCEEF": [
    "请填写正则表达式，或清空替换内容。",
    "Please fill in the regular expression or clear the replacement content.",
    "Vui lòng điền biểu thức chính quy hoặc xóa nội dung thay thế."
  ],
  "VALIDATION_QUALITY_REGEX_21D1D90F2F": [
    "正则替换仅支持字符串和数字类型。",
    "Regular replacement only supports string and numeric types.",
    "Thay thế thường xuyên chỉ hỗ trợ các loại chuỗi và số."
  ],
  "VALIDATION_QUALITY_REGEX_050B082A4B": [
    "正则表达式无效或包含不支持的语法；不支持前后查找和表达式内的反向引用。",
    "The regular expression is invalid or contains unsupported syntax; forward and backward lookups and backreferences within expressions are not supported.",
    "Biểu thức chính quy không hợp lệ hoặc chứa cú pháp không được hỗ trợ; tra cứu tiến và lùi cũng như tham chiếu ngược trong các biểu thức không được hỗ trợ."
  ],
  "VALIDATION_QUALITY_REGEX_7AB2A5A5E0": [
    "正则替换的原文不能超过 10000 个字符。",
    "The original text for regular replacement cannot exceed 10,000 characters.",
    "Văn bản gốc để thay thế thông thường không được vượt quá 10.000 ký tự."
  ],
  "VALIDATION_QUALITY_REGEX_95C7DC230D": [
    "正则替换后的内容不能超过 10000 个字符。",
    "The content after regular replacement cannot exceed 10,000 characters.",
    "Nội dung sau khi thay thế thông thường không được vượt quá 10.000 ký tự."
  ],
  "VALIDATION_QUALITY_TEMPLATE_A99C66DFC5": [
    "区域格式应为 A1 或 A1:F3。",
    "The range format should be A1 or A1:F3.",
    "Định dạng phạm vi phải là A1 hoặc A1:F3."
  ],
  "VALIDATION_QUALITY_TEMPLATE_E07D046DB8": [
    "区域不能超过 2000 行、100 列。",
    "Regions cannot exceed 2000 rows and 100 columns.",
    "Các vùng không thể vượt quá 2000 hàng và 100 cột."
  ],
  "VALIDATION_QUALITY_TEMPLATE_8ED58EE1D5": [
    "对象表头模式无效。",
    "The object header mode is invalid.",
    "Chế độ tiêu đề đối tượng không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_A426C388F5": [
    "请选择多级表头的排列方向。",
    "Please select the arrangement direction of multi-level headers.",
    "Vui lòng chọn hướng sắp xếp của tiêu đề đa cấp."
  ],
  "VALIDATION_QUALITY_TEMPLATE_DC97E9028F": [
    "多级表头须完整框选，末级属性单元格必须对齐表头末端。",
    "Multi-level headers must be completely selected, and the last-level attribute cells must be aligned with the end of the header.",
    "Tiêu đề đa cấp phải được chọn hoàn toàn và các ô thuộc tính cấp cuối cùng phải căn chỉnh với phần cuối của tiêu đề."
  ],
  "VALIDATION_QUALITY_TEMPLATE_8A4C99D98C": [
    "多级表头的父子分组须完整包含，不能交叉或跨越不同分组。",
    "The parent-child groupings of multi-level headers must be completely included and cannot cross or span different groups.",
    "Các nhóm cha-con của tiêu đề đa cấp phải được bao gồm hoàn toàn và không thể vượt qua hoặc mở rộng các nhóm khác nhau."
  ],
  "VALIDATION_QUALITY_TEMPLATE_EE1FEE0FD5": [
    "多级表头最多支持 20 层，当前表头选区为 {p0}。请检查是否选入明细数据：先仅框选表头并确认属性，再选择值区域；明细记录数不受此表头层数限制。",
    "Multi-level headers support up to 20 layers, and the current header selection is {p0}. Please check whether detailed data is selected: first select only the header and confirm the attributes, then select the value area; the number of detailed records is not limited by the number of levels in this header.",
    "Tiêu đề đa cấp hỗ trợ tối đa 20 lớp và lựa chọn tiêu đề hiện tại là {p0}. Vui lòng kiểm tra xem dữ liệu chi tiết có được chọn hay không: đầu tiên chỉ chọn tiêu đề và xác nhận các thuộc tính, sau đó chọn vùng giá trị; số lượng bản ghi chi tiết không bị giới hạn bởi số cấp độ trong tiêu đề này."
  ],
  "VALIDATION_QUALITY_TEMPLATE_740DD1CD67": [
    "请框选连续的一行或一列逻辑属性单元格；合并单元格须完整选中且排列对齐。",
    "Please frame-select a continuous row or column of logical attribute cells; the merged cells must be completely selected and aligned.",
    "Vui lòng chọn khung một hàng hoặc cột liên tục gồm các ô thuộc tính logic; các ô đã hợp nhất phải được chọn và căn chỉnh hoàn toàn."
  ],
  "VALIDATION_QUALITY_TEMPLATE_0E8293B14E": [
    "对象终止策略无效。",
    "The object termination policy is invalid.",
    "Chính sách chấm dứt đối tượng không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_3F65375A38": [
    "连续空行数须为 1～2000 的整数。",
    "The number of consecutive blank lines must be an integer from 1 to 2000.",
    "Số dòng trống liên tiếp phải là số nguyên từ 1 đến 2000."
  ],
  "VALIDATION_QUALITY_TEMPLATE_018C08F710": [
    "对象值区域的合并单元格须与属性对齐：值单元格 {p0} 与表头 {p1} 不对应。每条记录必须完整，不能跨越不同属性或记录；请检查是否选入备注或合计行。",
    "The merged cells of the object value area must be aligned with the attributes: the value cell {p0} does not correspond to the header {p1}. Each record must be complete and cannot span different attributes or records; please check whether comments or total rows are selected.",
    "Các ô được hợp nhất của vùng giá trị đối tượng phải được căn chỉnh với các thuộc tính: ô giá trị {p0} không tương ứng với tiêu đề {p1}. Mỗi bản ghi phải đầy đủ và không thể bao gồm các thuộc tính hoặc bản ghi khác nhau; vui lòng kiểm tra xem nhận xét hoặc tổng số hàng có được chọn hay không."
  ],
  "VALIDATION_QUALITY_TEMPLATE_73500EF2D5": [
    "选项拆分方式无效。",
    "Invalid option splitting method.",
    "Phương pháp tách tùy chọn không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_DDF9973D55": [
    "请填写允许选项。",
    "Please fill in the allow options.",
    "Vui lòng điền vào các tùy chọn cho phép."
  ],
  "VALIDATION_QUALITY_TEMPLATE_4C8A5546A8": [
    "允许选项不能重复。",
    "Allowed options cannot be repeated.",
    "Các tùy chọn được phép không thể lặp lại."
  ],
  "VALIDATION_QUALITY_TEMPLATE_280FC77889": [
    "选项标记位置无效。",
    "Invalid option tag position.",
    "Vị trí thẻ tùy chọn không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_532D77692E": [
    "请填写勾选字符。",
    "Please fill in the check characters.",
    "Vui lòng điền vào các ký tự kiểm tra."
  ],
  "VALIDATION_QUALITY_TEMPLATE_B90DB88CFE": [
    "请填写选项分隔符。",
    "Please fill in the option separator.",
    "Vui lòng điền vào dấu phân cách tùy chọn."
  ],
  "VALIDATION_QUALITY_TEMPLATE_EDDA50B321": [
    "未选中标记无效。",
    "Unchecked marks are invalid.",
    "Dấu không được chọn là không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_C83CFF4962": [
    "未选中标记最多 20 个，每个最多 10 个字符。",
    "Maximum of 20 unchecked marks, each of up to 10 characters.",
    "Tối đa 20 dấu không được đánh dấu, mỗi dấu có tối đa 10 ký tự."
  ],
  "VALIDATION_QUALITY_TEMPLATE_E819CFD802": [
    "未选中标记不能与勾选字符相同。",
    "The unchecked mark cannot be the same as the checked character.",
    "Dấu không được đánh dấu không thể giống với ký tự được đánh dấu."
  ],
  "VALIDATION_QUALITY_TEMPLATE_55593D0EAD": [
    "允许选项请填写实际选项文字，不能只有勾选符号。",
    "To allow options, please fill in the actual option text, not just the check mark.",
    "Để cho phép các tùy chọn, vui lòng điền vào văn bản tùy chọn thực tế chứ không chỉ dấu kiểm."
  ],
  "VALIDATION_QUALITY_TEMPLATE_7565D4D30E": [
    "允许选项去除勾选符号后不能重复。",
    "Allow options cannot be repeated after removing the check mark.",
    "Cho phép các tùy chọn không thể lặp lại sau khi xóa dấu kiểm."
  ],
  "VALIDATION_QUALITY_TEMPLATE_D7A23EE047": [
    "内容只有 {p0} 行，无法读取第 {p1} 行。",
    "The content is only {p0} lines, and the {p1} line cannot be read.",
    "Nội dung chỉ có dòng {p0}, dòng {p1} không đọc được."
  ],
  "VALIDATION_QUALITY_TEMPLATE_F862DF04C9": [
    "模板仅支持配置一个工作表。",
    "The template only supports configuring one worksheet.",
    "Mẫu chỉ hỗ trợ định cấu hình một bảng tính."
  ],
  "VALIDATION_QUALITY_TEMPLATE_7858AED2EC": [
    "模板最多配置 200 个字段。",
    "Templates can be configured with up to 200 fields.",
    "Mẫu có thể được cấu hình với tối đa 200 trường."
  ],
  "VALIDATION_QUALITY_TEMPLATE_9AA1723A6F": [
    "字段 ID 无效或重复。",
    "Field ID is invalid or duplicate.",
    "ID trường không hợp lệ hoặc trùng lặp."
  ],
  "VALIDATION_QUALITY_TEMPLATE_D7C039A222": [
    "选区超出工作表范围。",
    "The selection exceeds the worksheet.",
    "Lựa chọn vượt quá bảng tính."
  ],
  "VALIDATION_QUALITY_TEMPLATE_93526F78F3": [
    "选区必须包含完整合并单元格。",
    "The selection must contain all merged cells.",
    "Vùng chọn phải chứa tất cả các ô được hợp nhất."
  ],
  "VALIDATION_QUALITY_TEMPLATE_0C1AD1C398": [
    "字段类型无效。",
    "Invalid field type.",
    "Loại trường không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_618EA2BDC5": [
    "整个模板只能配置一个唯一 KEY（含对象属性）。",
    "Only one unique KEY (including object attributes) can be configured in the entire template.",
    "Chỉ có thể định cấu hình một KEY duy nhất (bao gồm các thuộc tính đối tượng) trong toàn bộ mẫu."
  ],
  "VALIDATION_QUALITY_TEMPLATE_BE3741DC93": [
    "分隔符无效。",
    "Invalid delimiter.",
    "Dấu phân cách không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_709D6AF4AE": [
    "测量值分隔符不能为空或包含数字、正负号、小数点。",
    "The measurement separator cannot be empty or contain numbers, signs, or decimal points.",
    "Dấu phân cách đo không được để trống hoặc chứa số, dấu hoặc dấu thập phân."
  ],
  "VALIDATION_QUALITY_TEMPLATE_025A3EA0F0": [
    "数字模式无效。",
    "Numeric mode is invalid.",
    "Chế độ số không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_28AEF0FB8C": [
    "日期格式无效。",
    "The date format is invalid.",
    "Định dạng ngày không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_80F1975804": [
    "特殊值映射最多 20 项。",
    "Special value mapping up to 20 items.",
    "Ánh xạ giá trị đặc biệt lên tới 20 mặt hàng."
  ],
  "VALIDATION_QUALITY_TEMPLATE_AC9CB78892": [
    "特殊值状态无效。",
    "Special value status is invalid.",
    "Trạng thái giá trị đặc biệt không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_6F684D565F": [
    "特殊值不能重复。",
    "Special values ​​cannot be repeated.",
    "Các giá trị đặc biệt không thể lặp lại."
  ],
  "VALIDATION_QUALITY_TEMPLATE_A1EB8DC9F3": [
    "唯一 KEY 不支持特殊值映射。",
    "Unique KEY does not support special value mapping.",
    "KEY duy nhất không hỗ trợ ánh xạ giá trị đặc biệt."
  ],
  "VALIDATION_QUALITY_TEMPLATE_6A664916FB": [
    "解析行须为所有行或有效的文字行号。",
    "Parse lines must be all lines or valid text line numbers.",
    "Các dòng phân tích phải là tất cả các dòng hoặc số dòng văn bản hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_02C4AC8C14": [
    "忽略内容最多 2000 个字符。",
    "Ignore content up to 2000 characters.",
    "Bỏ qua nội dung tối đa 2000 ký tự."
  ],
  "VALIDATION_QUALITY_TEMPLATE_CFDAC78289": [
    "顶层字段名称不能重复。",
    "Top-level field names cannot be repeated.",
    "Tên trường cấp cao nhất không thể lặp lại."
  ],
  "VALIDATION_QUALITY_TEMPLATE_EF6047D394": [
    "自定义 Key 仅支持普通字段。",
    "Custom Key only supports ordinary fields.",
    "Khóa tùy chỉnh chỉ hỗ trợ các trường thông thường."
  ],
  "VALIDATION_QUALITY_TEMPLATE_DF7D947110": [
    "请完成“{p0}”的配置。",
    "Please complete the configuration of \"{p0}\".",
    "Vui lòng hoàn thành cấu hình của \"{p0}\"."
  ],
  "VALIDATION_QUALITY_TEMPLATE_5984569733": [
    "对象属性排列方向无效。",
    "The object attribute arrangement direction is invalid.",
    "Hướng sắp xếp thuộc tính đối tượng không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_FBFD0F5FB9": [
    "竖向对象的值区域须位于属性列右侧且起止行一致。已确认表头 {p0}，当前值区域 {p1}；请选择第 {p2}～{p3} 行、{p4} 列右侧的值。若需读取其他行，请返回重选属性。",
    "The value area of vertical objects must be located on the right side of the attribute column and the starting and ending rows must be consistent. The header {p0} has been confirmed, and the current value area is {p1}; please select the value on the right side of rows {p2}~{p3} and column {p4}. If you need to read other rows, please return to the reselect attribute.",
    "Vùng giá trị của đối tượng dọc phải nằm ở phía bên phải của cột thuộc tính và hàng bắt đầu và kết thúc phải nhất quán. Tiêu đề {p0} đã được xác nhận và vùng giá trị hiện tại là {p1}; vui lòng chọn giá trị ở bên phải của hàng {p2}~{p3} và cột {p4}. Nếu bạn cần đọc các hàng khác, vui lòng quay lại thuộc tính chọn lại."
  ],
  "VALIDATION_QUALITY_TEMPLATE_1D2A42BD57": [
    "横向对象的值区域须位于属性行下方且起止列一致。已确认表头 {p0}，当前值区域 {p1}；请选择 {p2}～{p3} 列、第 {p4} 行下方的值。若需读取其他列，请返回重选属性。",
    "The value area of horizontal objects must be located below the attribute row and the starting and ending columns must be consistent. The header {p0} has been confirmed, and the current value area is {p1}; please select the value below the {p2}~{p3} column and the {p4} row. If you need to read other columns, please return to the reselect attribute.",
    "Vùng giá trị của đối tượng nằm ngang phải nằm phía dưới hàng thuộc tính và cột bắt đầu và cột kết thúc phải nhất quán. Tiêu đề {p0} đã được xác nhận và vùng giá trị hiện tại là {p1}; vui lòng chọn giá trị bên dưới cột {p2}~{p3} và hàng {p4}. Nếu bạn cần đọc các cột khác, vui lòng quay lại thuộc tính chọn lại."
  ],
  "VALIDATION_QUALITY_TEMPLATE_A1DB492F20": [
    "对象属性数量与选区不符。",
    "The number of object attributes does not match the selection.",
    "Số lượng thuộc tính đối tượng không khớp với lựa chọn."
  ],
  "VALIDATION_QUALITY_TEMPLATE_F82952BA4D": [
    "同一对象内的属性名称不能重复。",
    "Property names within the same object cannot be repeated.",
    "Tên thuộc tính trong cùng một đối tượng không thể lặp lại."
  ],
  "VALIDATION_QUALITY_TEMPLATE_50BC209C30": [
    "多级表头路径与所选区域不一致，请重新框选属性。",
    "The multi-level header path is inconsistent with the selected area. Please re-select the attribute.",
    "Đường dẫn tiêu đề đa cấp không nhất quán với vùng đã chọn. Vui lòng chọn lại thuộc tính."
  ],
  "VALIDATION_QUALITY_TEMPLATE_7E3DEC05A2": [
    "每个属性最多配置 100 条项目规则。",
    "Configure up to 100 project rules per attribute.",
    "Định cấu hình tối đa 100 quy tắc dự án cho mỗi thuộc tính."
  ],
  "VALIDATION_QUALITY_TEMPLATE_4FDF98B1FD": [
    "按项目配置的属性须使用字符串作为默认类型。",
    "Properties configured per project must use string as the default type.",
    "Thuộc tính được định cấu hình cho mỗi dự án phải sử dụng chuỗi làm loại mặc định."
  ],
  "VALIDATION_QUALITY_TEMPLATE_9996908FDF": [
    "匹配属性须为没有项目规则的其他字符串或唯一 KEY 属性。",
    "The matching attribute must be another string without an item rule or a unique KEY attribute.",
    "Thuộc tính phù hợp phải là một chuỗi khác không có quy tắc mục hoặc thuộc tính KEY duy nhất."
  ],
  "VALIDATION_QUALITY_TEMPLATE_54A36F9B22": [
    "同一属性的项目规则不能重复或使用不同匹配属性。",
    "Item rules for the same attribute cannot be repeated or use different matching attributes.",
    "Các quy tắc mục cho cùng một thuộc tính không thể được lặp lại hoặc sử dụng các thuộc tính khớp khác nhau."
  ],
  "VALIDATION_QUALITY_TEMPLATE_6FE78FBBFA": [
    "项目规则类型无效。",
    "Invalid project rule type.",
    "Loại quy tắc dự án không hợp lệ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_089939A0DF": [
    "数字、日期、日期时间、布尔和测量值列表只能读取一个逻辑单元格。",
    "Number, date, datetime, boolean, and measurement lists can only read a single logical cell.",
    "Danh sách số, ngày, giờ, boolean và phép đo chỉ có thể đọc một ô logic duy nhất."
  ],
  "VALIDATION_QUALITY_TEMPLATE_F8335D73A8": [
    "自定义 Key 请直接配置取值区域。",
    "To customize Key, please directly configure the value area.",
    "Để tùy chỉnh Khóa, vui lòng định cấu hình trực tiếp vùng giá trị."
  ],
  "VALIDATION_QUALITY_TEMPLATE_A7782FB17D": [
    "方向与取值区域不一致，请重新选择或改为自定义区域。",
    "The direction is inconsistent with the value area, please reselect or change to a custom area.",
    "Hướng không nhất quán với vùng giá trị, vui lòng chọn lại hoặc thay đổi thành vùng tùy chỉnh."
  ],
  "VALIDATION_QUALITY_TEMPLATE_7FBEF7E309": [
    "请至少配置一个字段。",
    "Please configure at least one field.",
    "Vui lòng định cấu hình ít nhất một trường."
  ],
  "VALIDATION_QUALITY_TEMPLATE_F06B19BD63": [
    "数字格式无效，请明确单一数值。",
    "The number format is invalid, please specify a single value.",
    "Định dạng số không hợp lệ, vui lòng chỉ định một giá trị duy nhất."
  ],
  "VALIDATION_QUALITY_TEMPLATE_829E89912A": [
    "数值超出支持范围。",
    "The value is outside the supported range.",
    "Giá trị nằm ngoài phạm vi được hỗ trợ."
  ],
  "VALIDATION_QUALITY_TEMPLATE_B753493710": [
    "请选择勾选字符及允许选项。",
    "Please select check characters and allow options.",
    "Vui lòng chọn các ký tự kiểm tra và cho phép các tùy chọn."
  ],
  "VALIDATION_QUALITY_TEMPLATE_5ED16A9211": [
    "整格文字未精确匹配允许选项。",
    "The entire text does not exactly match the allowed options.",
    "Toàn bộ văn bản không khớp chính xác với các tùy chọn được phép."
  ],
  "VALIDATION_QUALITY_TEMPLATE_2A86E18ECA": [
    "分隔符与原文不匹配：拆分后仍包含多个选项标记，请检查分隔符。",
    "The delimiter does not match the original text: it still contains multiple option tags after splitting, please check the delimiter.",
    "Dấu phân cách không khớp với văn bản gốc: nó vẫn chứa nhiều thẻ tùy chọn sau khi tách, vui lòng kiểm tra dấu phân cách."
  ],
  "VALIDATION_QUALITY_TEMPLATE_DDD03B9580": [
    "后置标记的选项文字或标记不匹配，请检查配置。",
    "The option text or tag of the post tag does not match, please check the configuration.",
    "Văn bản tùy chọn hoặc thẻ của thẻ bài không khớp, vui lòng kiểm tra cấu hình."
  ],
  "VALIDATION_QUALITY_TEMPLATE_B6D59CD0F5": [
    "单选命中多个选项。",
    "Single selection hits multiple options.",
    "Lựa chọn duy nhất đạt được nhiều tùy chọn."
  ],
  "VALIDATION_QUALITY_TEMPLATE_99F7321444": [
    "必填值为空。",
    "Required value is empty.",
    "Giá trị bắt buộc trống."
  ],
  "VALIDATION_QUALITY_TEMPLATE_777B74CBBF": [
    "对象至少需要一条记录。",
    "The object requires at least one record.",
    "Đối tượng yêu cầu ít nhất một bản ghi."
  ],
  "VALIDATION_QUALITY_VALUE_TYPES_4C4E352C17": [
    "布尔值映射最多 2000 个字符。",
    "Boolean map up to 2000 characters.",
    "Bản đồ Boolean lên tới 2000 ký tự."
  ],
  "VALIDATION_QUALITY_VALUE_TYPES_AF2B0844AE": [
    "真值和假值各须配置 1～20 项，每项最多 100 个字符。",
    "True value and false value must be configured with 1 to 20 items each, with a maximum of 100 characters for each item.",
    "Giá trị đúng và giá trị sai phải được định cấu hình từ 1 đến 20 mục mỗi mục, với tối đa 100 ký tự cho mỗi mục."
  ],
  "VALIDATION_QUALITY_VALUE_TYPES_49915DA5DD": [
    "同一组布尔值映射不能重复（不区分英文大小写）。",
    "The same set of Boolean value mappings cannot be repeated (English case-insensitive).",
    "Không thể lặp lại cùng một bộ ánh xạ giá trị Boolean (tiếng Anh không phân biệt chữ hoa chữ thường)."
  ],
  "VALIDATION_QUALITY_VALUE_TYPES_CDD8F99A14": [
    "真值和假值映射不能重叠。",
    "True and false mappings cannot overlap.",
    "Ánh xạ đúng và sai không thể trùng nhau."
  ],
  "VALIDATION_QUALITY_VALUE_TYPES_FC2DA91573": [
    "文字未匹配真值或假值，请检查布尔值映射。",
    "Literal does not match true or false values, please check the boolean map.",
    "Nghĩa đen không khớp với giá trị đúng hoặc sai, vui lòng kiểm tra bản đồ boolean."
  ],
  "VALIDATION_QUALITY_VALUE_TYPES_8B15956317": [
    "日期时间格式无效，请按指定格式填写有效日期和时间。",
    "The date and time format is invalid. Please fill in the valid date and time in the specified format.",
    "Định dạng ngày và giờ không hợp lệ. Vui lòng điền ngày và giờ hợp lệ theo định dạng đã chỉ định."
  ],
  "VALIDATION_QUALITY_VALUE_TYPES_E6D8C70D3E": [
    "百分比格式无效，请填写单一数值，例如 95 或 95%。",
    "Invalid percentage format, please enter a single value, such as 95 or 95%.",
    "Định dạng phần trăm không hợp lệ, vui lòng nhập một giá trị duy nhất, chẳng hạn như 95 hoặc 95%."
  ],
  "VALIDATION_QUALITY_WORKBOOK_8EA1518AFA": [
    "请选择不超过 10 MB 的 .xlsx 文件。",
    "Please select an .xlsx file that is no larger than 10 MB.",
    "Vui lòng chọn tệp .xlsx không lớn hơn 10 MB."
  ],
  "VALIDATION_QUALITY_WORKBOOK_33CB0D2842": [
    "Excel 文件无效或解压后过大。",
    "The Excel file is invalid or too large after decompression.",
    "Tệp Excel không hợp lệ hoặc quá lớn sau khi giải nén."
  ],
  "VALIDATION_QUALITY_WORKBOOK_54EAC5275C": [
    "Excel 文件无效。",
    "The Excel file is invalid.",
    "Tệp Excel không hợp lệ."
  ],
  "VALIDATION_QUALITY_WORKBOOK_297BA28332": [
    "无法读取 Excel，请使用有效且未加密的 .xlsx 文件。",
    "Unable to read Excel, please use a valid, unencrypted .xlsx file.",
    "Không thể đọc Excel, vui lòng sử dụng tệp .xlsx hợp lệ, không được mã hóa."
  ],
  "VALIDATION_QUALITY_WORKBOOK_554CBE6960": [
    "工作簿需要包含 1–20 个工作表。",
    "Workbook needs to contain 1–20 worksheets.",
    "Sổ làm việc cần chứa 1–20 trang tính."
  ],
  "VALIDATION_QUALITY_WORKBOOK_F474D57CCD": [
    "工作表范围过大（最多 2000 行、100 列、50000 格）。",
    "The worksheet range is too large (maximum 2000 rows, 100 columns, 50000 cells).",
    "Phạm vi trang tính quá lớn (tối đa 2000 hàng, 100 cột, 50000 ô)."
  ],
  "VALIDATION_QUALITY_WORKBOOK_2462FCEE8E": [
    "单元格内容过长。",
    "Cell content is too long.",
    "Nội dung ô quá dài."
  ],
  "VALIDATION_QUALITY_WORKBOOK_2A30ABE590": [
    "表格内容超过 5 MB，请减少工作表内容。",
    "The table content exceeds 5 MB, please reduce the worksheet content.",
    "Nội dung bảng vượt quá 5 MB, vui lòng giảm nội dung bảng tính."
  ],
  "VALIDATION_QUANTITY_6D8F1367A9": [
    "数量需为正数，最多 4 位小数，上限为 {p1}。",
    "The quantity needs to be a positive number, up to 4 decimal places, and the upper limit is {p1}.",
    "Số lượng cần phải là số dương, tối đa 4 chữ số thập phân và giới hạn trên là {p1}."
  ],
  "VALIDATION_QUANTITY_A16568E0F8": [
    "数量需为非负数，最多 4 位小数，上限为 {p1}。",
    "The quantity needs to be a non-negative number with up to 4 decimal places and an upper limit of {p1}.",
    "Số lượng cần phải là số không âm có tối đa 4 chữ số thập phân và giới hạn trên là {p1}."
  ],
  "VALIDATION_QUANTITY_4BD9898315": [
    "数量需为{p0}，最多 4 位小数，上限为 {p1}。",
    "The quantity needs to be {p0}, up to 4 decimal places, and the upper limit is {p1}.",
    "Số lượng cần phải là {p0}, tối đa 4 chữ số thập phân và giới hạn trên là {p1}."
  ],
  "VALIDATION_QUANTITY_D52BBEE45A": [
    "数量需为非负数，最多 6 位小数。",
    "The quantity needs to be a non-negative number with up to 6 decimal places.",
    "Số lượng phải là số không âm có tối đa 6 chữ số thập phân."
  ],
  "VALIDATION_SCRAP_4D2B3A2406": [
    "废料产出最多 100 种。",
    "Scrap output can be up to 100 types.",
    "Sản lượng phế liệu có thể lên tới 100 loại."
  ],
  "VALIDATION_SCRAP_0A15486B37": [
    "废料不能重复，也不能与成品或投入材料相同；可用原料剩余请按余料处理。",
    "Scrap materials cannot be repeated, nor can they be the same as finished products or input materials; remaining available raw materials should be treated as remaining materials.",
    "Phế liệu không thể lặp lại, không thể giống hệt thành phẩm, nguyên liệu đầu vào; nguyên liệu thô sẵn có còn lại nên được coi là nguyên liệu còn lại."
  ],
  "VALIDATION_SCRAP_49C45B032B": [
    "废料单位或备注无效。",
    "The scrap unit or comment is invalid.",
    "Đơn vị mẩu tin lưu niệm hoặc nhận xét không hợp lệ."
  ],
  "VALIDATION_SCRAP_CE010B8DD0": [
    "废料计算方式无效。",
    "The scrap calculation method is invalid.",
    "Phương pháp tính phế liệu không hợp lệ."
  ],
  "VALIDATION_SCRAP_3F78B4F4EA": [
    "废料比例需为大于 0 且不超过 100 的百分数，来源须为同单位的投入材料。",
    "The scrap ratio needs to be a percentage greater than 0 and not exceeding 100, and the source must be the input material of the same unit.",
    "Tỷ lệ phế liệu cần phải là tỷ lệ phần trăm lớn hơn 0 và không quá 100 và nguồn phải là nguyên liệu đầu vào của cùng một đơn vị."
  ],
  "VALIDATION_SCRAP_C24263C084": [
    "按产量计算的废料不能指定投入材料。",
    "Scrap by volume cannot specify input materials.",
    "Phế liệu theo khối lượng không thể xác định được nguyên liệu đầu vào."
  ],
  "VALIDATION_SCRAP_BF24BD451E": [
    "同一投入材料的废料比例合计不能超过 100%。",
    "The total scrap proportion of the same input material cannot exceed 100%.",
    "Tổng tỷ lệ phế liệu của cùng một loại nguyên liệu đầu vào không được vượt quá 100%."
  ],
  "VALIDATION_SCRAP_079FE24B84": [
    "请先填写有效的产量和实际耗料，再核对预计废料。",
    "Please fill in the valid production volume and actual material consumption first, and then check the estimated waste.",
    "Vui lòng điền vào khối lượng sản xuất hợp lệ và mức tiêu thụ nguyên liệu thực tế trước, sau đó kiểm tra lượng lãng phí ước tính."
  ],
  "VALIDATION_SCRAP_50795E0808": [
    "请核对全部废料的实际产出与处理方式。",
    "Please check the actual output and disposal methods of all waste materials.",
    "Vui lòng kiểm tra sản lượng thực tế và phương pháp xử lý của tất cả các vật liệu phế thải."
  ],
  "VALIDATION_SCRAP_7B5DF19C2F": [
    "废料实际产出需为非负数且最多 4 位小数，处理方式为入库或直接处置，物料不能增删或重复。",
    "The actual output of scrap must be a non-negative number with up to 4 decimal places. The processing method is warehousing or direct disposal. Materials cannot be added, deleted, or repeated.",
    "Sản lượng phế liệu thực tế phải là số không âm tối đa 4 chữ số thập phân. Phương pháp xử lý là nhập kho hoặc tiêu hủy trực tiếp. vật tư không thể được thêm, xóa hoặc lặp lại."
  ],
  "VALIDATION_STOCK_COMPARE_88D81C19CB": [
    "对比表达式需要选择一个有效的起始仓库。",
    "Comparison expressions require selection of a valid starting repository.",
    "Biểu thức so sánh yêu cầu lựa chọn kho lưu trữ bắt đầu hợp lệ."
  ],
  "VALIDATION_STOCK_COMPARE_D13A1D7BBD": [
    "对比表达式最多支持 20 个仓库项。",
    "Comparison expressions support up to 20 warehouse items.",
    "Biểu thức so sánh hỗ trợ tối đa 20 mặt hàng trong kho."
  ],
  "VALIDATION_STOCK_COMPARE_98846EECD5": [
    "对比表达式的运算符只能为加或减。",
    "The operators for comparison expressions can only be addition or subtraction.",
    "Các toán tử cho biểu thức so sánh chỉ có thể là phép cộng hoặc phép trừ."
  ],
  "VALIDATION_STOCK_COMPARE_A94DF1E888": [
    "对比表达式包含不存在的仓库。",
    "The comparison expression contains a repository that does not exist.",
    "Biểu thức so sánh chứa kho lưu trữ không tồn tại."
  ],
  "VALIDATION_STOCK_COMPARE_DD7998B9F7": [
    "对比表达式中同一仓库不能重复。",
    "The same warehouse cannot be repeated in the comparison expression.",
    "Kho tương tự không thể được lặp lại trong biểu thức so sánh."
  ],
  "QUALITY_AXIS_FIELD_INVALID": [
    "横轴字段不存在或数据类型不适用。",
    "The horizontal axis field is missing or has an unsupported data type.",
    "Trường trục ngang không tồn tại hoặc có kiểu dữ liệu không hỗ trợ."
  ],
  "QUALITY_DATE_FIELD_INVALID": [
    "日期筛选字段不存在或数据类型不适用。",
    "The date filter field is missing or has an unsupported data type.",
    "Trường lọc ngày không tồn tại hoặc có kiểu dữ liệu không hỗ trợ."
  ],
  "QUALITY_GROUP_FIELD_INVALID": [
    "分组字段不存在或数据类型不适用。",
    "The grouping field is missing or has an unsupported data type.",
    "Trường phân nhóm không tồn tại hoặc có kiểu dữ liệu không hỗ trợ."
  ],
  "QUALITY_METRIC_FIELD_INVALID": [
    "统计值字段不存在或数据类型不适用。",
    "The metric field is missing or has an unsupported data type.",
    "Trường giá trị thống kê không tồn tại hoặc có kiểu dữ liệu không hỗ trợ."
  ],
  "QUALITY_MATERIAL_ID_INVALID": [
    "物料编号无效。",
    "Invalid material ID.",
    "Mã vật tư không hợp lệ."
  ],
  "QUALITY_ACCEPTANCE_ID_INVALID": [
    "验收单编号无效。",
    "Invalid acceptance document ID.",
    "Mã phiếu nghiệm thu không hợp lệ."
  ]
};
export const validationNestedParams = {"VALIDATION_AUTH_56FB08F914": ["p0"], "VALIDATION_PRODUCTION_4A3C3368D5": ["p0"]};
export const { validationErrorInfo, translateValidationError } = createValidationTranslator(validationMessages, validationNestedParams);
