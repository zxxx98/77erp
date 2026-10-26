import { validationMessages, validationErrorInfo, validationNestedParams } from '../shared/error-translations.js';

export const supportedLanguages = Object.freeze(['zh-CN', 'en', 'vi']);
export const isSupportedLanguage = value => typeof value === 'string' && supportedLanguages.includes(value);

// Resolve independently for every request; switching another account never mutates shared state.
export function requestLanguage(req) {
  if (isSupportedLanguage(req.query?.language)) return req.query.language;
  const accepted = String(req.get?.('Accept-Language') || '').split(',').map((part, index) => {
    const [tag, ...options] = part.trim().split(';');
    const quality = options.find(value => value.trim().startsWith('q='));
    return { tag: tag.toLowerCase(), quality: quality ? Number(quality.trim().slice(2)) : 1, index };
  }).filter(value => value.quality > 0 && value.quality <= 1).sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of accepted) {
    if (/^zh(?:-|$)/.test(tag)) return 'zh-CN';
    if (/^en(?:-|$)/.test(tag)) return 'en';
    if (/^vi(?:-|$)/.test(tag)) return 'vi';
  }
  return isSupportedLanguage(req.user?.language) ? req.user.language : 'zh-CN';
}

export const serverMessages = {
  'pdf.scanOperations': ['扫码后选择生产层及工序登记', 'Scan to select a production layer and report an operation', 'Quét để chọn cấp sản xuất và ghi nhận công đoạn'],
  ...validationMessages,
  CONTEXT_VALIDATION_FAILED: ['{context}：{detail}', '{context}: {detail}', '{context}: {detail}'],
  'pdf.title': ['生产任务单', 'Production task sheet', 'Phiếu nhiệm vụ sản xuất'],
  'pdf.number': ['单号：{value}', 'Order: {value}', 'Số lệnh: {value}'],
  'pdf.warehouseGroup': ['仓库：{warehouse}    生产组：{group}', 'Warehouse: {warehouse}    Production group: {group}', 'Kho: {warehouse}    Nhóm sản xuất: {group}'],
  'pdf.void': ['已作废 · 此任务单不可用于生产登记', 'Voided · Do not use this sheet for production registration', 'Đã hủy · Không dùng phiếu này để ghi nhận sản xuất'],
  'pdf.voidReason': ['作废原因：{value}', 'Reason for voiding: {value}', 'Lý do hủy: {value}'],
  'pdf.product': ['产品：{value}', 'Product: {value}', 'Sản phẩm: {value}'],
  'pdf.identity': ['编码：{barcode}    规格：{specification}', 'Code: {barcode}    Specification: {specification}', 'Mã: {barcode}    Quy cách: {specification}'],
  'pdf.quantity': ['计划数量：{quantity} {unit}', 'Planned quantity: {quantity} {unit}', 'Số lượng kế hoạch: {quantity} {unit}'],
  'pdf.bom': ['BOM 快照：{name} / 版本 {version} / 基准 {quantity} {unit}', 'BOM snapshot: {name} / revision {version} / base {quantity} {unit}', 'Bản chụp BOM: {name} / phiên bản {version} / cơ sở {quantity} {unit}'],
  'pdf.address': ['访问地址：{value}', 'Server address: {value}', 'Địa chỉ máy chủ: {value}'],
  'pdf.scanStages': ['扫码后选择成品或半成品登记', 'Scan to select finished or intermediate product registration', 'Quét để chọn ghi nhận thành phẩm hoặc bán thành phẩm'],
  'pdf.scan': ['扫码打开生产登记', 'Scan to open production registration', 'Quét để mở ghi nhận sản xuất'],
  'pdf.instructions': ['请使用有权限的账号登录，核对生产单后登记。\n手机必须能访问生成此任务单的服务器地址。\n扫码仅打开表单，不会自动提交。', 'Sign in with an authorized account and verify the order before registration.\nYour phone must be able to reach this server.\nScanning opens the form; it does not submit it.', 'Đăng nhập bằng tài khoản có quyền và kiểm tra lệnh trước khi ghi nhận.\nĐiện thoại phải truy cập được máy chủ này.\nQuét chỉ mở biểu mẫu, không tự động gửi.'],
  'pdf.materials': ['计划用料（保存时的 BOM 快照）', 'Planned materials (saved BOM snapshot)', 'Vật tư kế hoạch (bản chụp BOM đã lưu)'],
  'pdf.materialsContinued': ['计划用料（续）', 'Planned materials (continued)', 'Vật tư kế hoạch (tiếp theo)'],
  'pdf.continued': ['（续）{value}', '(continued) {value}', '(tiếp) {value}'],
  'pdf.materialName': ['物料名称', 'Material name', 'Tên vật tư'],
  'pdf.materialCode': ['物料编码', 'Material code', 'Mã vật tư'],
  'pdf.specification': ['规格', 'Specification', 'Quy cách'],
  'pdf.unit': ['单位', 'Unit', 'Đơn vị'],
  'pdf.plannedQuantity': ['计划用量', 'Planned quantity', 'Lượng kế hoạch'],
  'pdf.materialNote': ['材料备注', 'Material notes', 'Ghi chú vật tư'],
  'pdf.notes': ['生产备注', 'Production notes', 'Ghi chú sản xuất'],
  'pdf.footer': ['导出：{time}（北京时间）  单号：{number}  第 {page} / {pages} 页', 'Exported: {time} (Beijing time)  Order: {number}  Page {page} / {pages}', 'Xuất: {time} (giờ Bắc Kinh)  Số lệnh: {number}  Trang {page} / {pages}'],
  WAREHOUSE_NOT_FOUND: ['仓库不存在，请重新选择仓库。', 'Warehouse not found. Please select a warehouse again.', 'Không tìm thấy kho. Vui lòng chọn lại kho.'],
  AUTH_REQUIRED: ['请登录后继续操作。', 'Please sign in to continue.', 'Vui lòng đăng nhập để tiếp tục.'],
  AUTH_INVALID_CREDENTIALS: ['账号或密码错误。', 'Incorrect username or password.', 'Tên đăng nhập hoặc mật khẩu không đúng.'],
  AUTH_SESSION_EXPIRED: ['登录已失效，请重新登录。', 'Your session has expired. Please sign in again.', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'],
  AUTH_FORBIDDEN: ['没有此操作的权限，请联系管理员。', 'You do not have permission for this action. Contact an administrator.', 'Bạn không có quyền thực hiện thao tác này. Vui lòng liên hệ quản trị viên.'],
  AUTH_PRODUCTION_ONLY: ['此岗位仅允许查看本组生产单并登记。', 'This position can only view and register production orders for its group.', 'Vị trí này chỉ được xem và ghi nhận lệnh sản xuất của nhóm mình.'],
  AUTH_SAME_ORIGIN: ['请从当前站点提交请求。', 'Please submit requests from this site.', 'Vui lòng gửi yêu cầu từ trang web này.'],
  REQUEST_JSON_REQUIRED: ['请求必须使用 JSON 格式。', 'The request must use JSON format.', 'Yêu cầu phải sử dụng định dạng JSON.'],
  REQUEST_MULTIPART_REQUIRED: ['文件上传必须使用 multipart/form-data 格式。', 'File uploads must use multipart/form-data.', 'Tải tệp lên phải sử dụng multipart/form-data.'],
  AUTH_RATE_LIMITED: ['尝试次数过多，请在 15 分钟后重试。', 'Too many attempts. Please try again in 15 minutes.', 'Quá nhiều lần thử. Vui lòng thử lại sau 15 phút.'],
  REQUEST_RATE_LIMITED: ['请求过于频繁，请稍后重试。', 'Too many requests. Please try again later.', 'Quá nhiều yêu cầu. Vui lòng thử lại sau.'],
  LANGUAGE_UNSUPPORTED: ['请选择有效的界面语言。', 'Please select a supported interface language.', 'Vui lòng chọn ngôn ngữ giao diện được hỗ trợ.'],
  ACCOUNT_CHANGED: ['当前登录账号已变化，请刷新后重试。', 'The signed-in account has changed. Refresh and try again.', 'Tài khoản đăng nhập đã thay đổi. Làm mới và thử lại.'],
  AUTH_ALREADY_INITIALIZED: ['管理员已设置，请直接登录。', 'The administrator is already configured. Please sign in.', 'Quản trị viên đã được thiết lập. Vui lòng đăng nhập.'],
  AUTH_SETUP_REQUIRED: ['请先设置管理员。', 'Please set up the administrator first.', 'Vui lòng thiết lập quản trị viên trước.'],
  AUTH_INVALID_USERNAME: ['账号需为 3–32 位字母、数字或 ._-。', 'Username must contain 3–32 letters, numbers or ._-.', 'Tên đăng nhập phải gồm 3–32 chữ cái, chữ số hoặc ._-.'],
  AUTH_INVALID_PASSWORD: ['密码需为 8–128 位字符。', 'Password must contain 8–128 characters.', 'Mật khẩu phải gồm 8–128 ký tự.'],
  AUTH_INVALID_NAME: ['名称最多 60 个字。', 'Name must not exceed 60 characters.', 'Tên không được vượt quá 60 ký tự.'],
  CURRENCY_INVALID_BASE: ['请选择有效的基准币种。', 'Please select a valid base currency.', 'Vui lòng chọn đồng tiền cơ sở hợp lệ.'],
  AUTH_WRONG_CURRENT_PASSWORD: ['当前密码错误。', 'The current password is incorrect.', 'Mật khẩu hiện tại không đúng.'],
  AUTH_AUTHORIZATION_CHANGED: ['登录或权限已变化，请重新登录。', 'Your session or permissions have changed. Please sign in again.', 'Phiên đăng nhập hoặc quyền đã thay đổi. Vui lòng đăng nhập lại.'],
  AUTH_INVALID_ACCOUNT: ['请填写有效账号、8–128 位密码、角色及最多 60 个字的名称。', 'Enter a valid username, an 8–128 character password, a role and a name of up to 60 characters.', 'Nhập tên đăng nhập hợp lệ, mật khẩu 8–128 ký tự, vai trò và tên tối đa 60 ký tự.'],
  AUTH_USERNAME_TAKEN: ['该账号已存在。', 'This username already exists.', 'Tên đăng nhập này đã tồn tại.'],
  AUTH_ACCOUNT_NOT_FOUND: ['账号不存在。', 'Account not found.', 'Không tìm thấy tài khoản.'],
  AUTH_LAST_ADMIN: ['不能停用或降级最后一个管理员。', 'The last administrator cannot be disabled or demoted.', 'Không thể vô hiệu hóa hoặc hạ cấp quản trị viên cuối cùng.'],
  AUTH_INVALID_ROLE: ['请选择有效角色、账号状态，并填写最多 60 个字的名称。', 'Select a valid role and account status, and enter a name of up to 60 characters.', 'Chọn vai trò, trạng thái tài khoản hợp lệ và nhập tên tối đa 60 ký tự.'],
  AUTH_POSITION_VERSION_REQUIRED: ['请通过调整岗位操作提交当前权限版本。', 'Use Change position to submit the current permission version.', 'Dùng thao tác đổi vị trí để gửi phiên bản quyền hiện tại.'],
  AUTH_GROUP_VERSION_REQUIRED: ['请通过调整生产组操作提交当前权限版本。', 'Use Change production group to submit the current permission version.', 'Dùng thao tác đổi nhóm sản xuất để gửi phiên bản quyền hiện tại.'],
  AUTH_POSITION_AUTHORIZATION_REQUIRED: ['员工权限已改为岗位授权，请刷新页面，在岗位配置中修改权限或为员工调整岗位。', 'Employee access is now managed through positions. Refresh the page to edit position permissions or change the employee’s position.', 'Quyền nhân viên hiện được quản lý theo vị trí. Làm mới trang để sửa quyền vị trí hoặc đổi vị trí của nhân viên.'],
  REQUEST_TOO_LARGE: ['提交内容过大，请减少行数或选择更小的文件。', 'The submitted content is too large. Reduce the number of rows or choose a smaller file.', 'Nội dung gửi quá lớn. Giảm số dòng hoặc chọn tệp nhỏ hơn.'],
  REQUEST_INVALID_JSON: ['提交内容不是有效的 JSON。', 'The submitted content is not valid JSON.', 'Nội dung gửi không phải JSON hợp lệ.'],
  REQUEST_INVALID_FORMAT: ['请求格式错误。', 'Invalid request format.', 'Định dạng yêu cầu không hợp lệ.'],
  SERVICE_UNAVAILABLE: ['服务暂时不可用，请稍后重试。', 'The service is temporarily unavailable. Please try again later.', 'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau.'],
  AI_IMAGE_ONLY: ['请帮我分析上传的图片。', 'Please analyze the uploaded images.', 'Vui lòng phân tích các hình ảnh đã tải lên.'],
  AI_TOOL_LIMIT: ['本次已达到工具调用上限，请核对已有预览，或进一步明确需求。', 'The tool call limit has been reached. Review the existing previews or clarify your request.', 'Đã đạt giới hạn gọi công cụ. Vui lòng kiểm tra bản xem trước hoặc làm rõ yêu cầu.'],
  AI_FORBIDDEN: ['没有 AI 助手使用权限。', 'You do not have permission to use the AI assistant.', 'Bạn không có quyền sử dụng trợ lý AI.'],
  AI_DISABLED: ['AI 助手未启用。', 'The AI assistant is not enabled.', 'Trợ lý AI chưa được bật.'],
  AI_WRITE_DISABLED: ['管理员已关闭 AI 写操作。', 'An administrator has disabled AI write actions.', 'Quản trị viên đã tắt thao tác ghi của AI.'],
  AI_BUSY: ['上一条 AI 请求仍在处理中。', 'Your previous AI request is still being processed.', 'Yêu cầu AI trước đó vẫn đang được xử lý.'],
  AI_QUOTA_EXHAUSTED: ['今日 AI 请求额度已用完。', 'Your daily AI request limit has been reached.', 'Đã dùng hết hạn mức yêu cầu AI hôm nay.'],
  AI_INVALID_MESSAGE: ['请输入1–4000字的需求。', 'Enter a request of 1–4000 characters.', 'Nhập yêu cầu gồm 1–4000 ký tự.'],
  AI_CONVERSATION_LIMIT: ['本次对话已达长度限制，请开始新对话。', 'This conversation has reached its length limit. Start a new conversation.', 'Cuộc trò chuyện đã đạt giới hạn độ dài. Vui lòng bắt đầu cuộc trò chuyện mới.'],
  AI_CONNECTION_FAILED: ['AI 服务连接失败或超时，请稍后重试。', 'The AI service connection failed or timed out. Please try again later.', 'Kết nối dịch vụ AI thất bại hoặc hết thời gian chờ. Vui lòng thử lại sau.'],
  AI_RESPONSE_TOO_LARGE: ['AI 响应超过256KB限制。', 'The AI response exceeds the 256 KB limit.', 'Phản hồi AI vượt giới hạn 256 KB.'],
  AI_RESPONSE_READ_FAILED: ['AI 响应读取失败或超时，请检查服务商连接。', 'Reading the AI response failed or timed out. Check the provider connection.', 'Không đọc được phản hồi AI hoặc hết thời gian chờ. Kiểm tra kết nối nhà cung cấp.'],
  AI_RESPONSE_INVALID_CONTENT: ['AI 服务返回了不支持的内容格式；需要文本或 Chat Completions 工具调用。', 'The AI service returned an unsupported format. Text or Chat Completions tool calls are required.', 'Dịch vụ AI trả về định dạng không hỗ trợ. Cần văn bản hoặc lệnh gọi công cụ Chat Completions.'],
  AI_RESPONSE_INVALID_TOOLS: ['AI 服务返回了无效工具调用列表。', 'The AI service returned an invalid tool call list.', 'Dịch vụ AI trả về danh sách gọi công cụ không hợp lệ.'],
  AI_RESPONSE_INCOMPLETE_TOOL: ['AI 服务返回了不完整的工具调用；请检查模型是否支持 Function Calling。', 'The AI service returned an incomplete tool call. Check whether the model supports Function Calling.', 'Dịch vụ AI trả về lệnh gọi công cụ chưa đầy đủ. Kiểm tra mô hình có hỗ trợ Function Calling không.'],
  AI_PREVIEW_SUPERSEDED: ['已继续对话，此预览已取消，请重新生成。', 'The conversation has continued, so this preview was cancelled. Generate it again.', 'Cuộc trò chuyện đã tiếp tục nên bản xem trước này đã bị hủy. Vui lòng tạo lại.'],
  AI_PREVIEW_EXPIRED: ['预览已过期，请重新生成。', 'This preview has expired. Generate it again.', 'Bản xem trước đã hết hạn. Vui lòng tạo lại.'],
  AI_PREVIEW_STALE: ['库存或业务资料已变化，请重新生成预览。', 'Inventory or business data has changed. Generate a new preview.', 'Tồn kho hoặc dữ liệu nghiệp vụ đã thay đổi. Vui lòng tạo lại bản xem trước.'],
  AI_IMPORT_INVALID_FILE: ['文件存在错误，未生成可执行预览。请修正文件后重新上传。', 'The file contains errors. No executable preview was created. Correct the file and upload it again.', 'Tệp có lỗi nên chưa tạo bản xem trước có thể thực hiện. Sửa tệp và tải lại.'],
  AI_PREVIEW_ONLY: ['仅生成预览，尚未执行。请用户在操作卡片核对并确认。', 'Preview only; nothing has been executed. Review and confirm the action card.', 'Chỉ mới tạo bản xem trước, chưa thực hiện. Vui lòng kiểm tra và xác nhận thẻ thao tác.'],
  AI_CHART_PREVIEW_PRODUCT_REQUIRED: ['物料图表按当前物料取数，未指定预览物料；保存后可在物料详情查看。', 'Material charts use data for the current material. No preview material was selected; view the chart in material details after saving.', 'Biểu đồ vật tư dùng dữ liệu của vật tư hiện tại. Chưa chọn vật tư xem trước; sau khi lưu có thể xem trong chi tiết vật tư.'],
  AI_CHART_NO_DATA: ['当前没有可用于此配置的已保存数据。', 'There is no saved data for this configuration.', 'Hiện chưa có dữ liệu đã lưu cho cấu hình này.'],
  AI_CHART_SHEET_RECORD: ['每个工作表一条记录', 'One record per worksheet', 'Một bản ghi cho mỗi trang tính'],
  AI_CHART_MATERIAL: ['物料', 'Material', 'Vật tư'],
  AI_CHART_NO_FIELD: ['无', 'None', 'Không có'],
  IMPORT_INITIAL_STOCK_INVALID: ['期初库存需为非负数且最多 4 位小数。', 'Opening stock must be non-negative with up to 4 decimal places.', 'Tồn đầu kỳ phải không âm và có tối đa 4 chữ số thập phân.'],
  IMPORT_DUPLICATE_BARCODE: ['条码重复或已存在，不会覆盖已有物料。', 'The barcode is duplicated or already exists. Existing materials will not be overwritten.', 'Mã vạch trùng lặp hoặc đã tồn tại. Không ghi đè vật tư hiện có.'],
  IMPORT_CATEGORY_WRONG_WAREHOUSE: ['分类不存在或不属于当前仓库。', 'The category does not exist or does not belong to the current warehouse.', 'Danh mục không tồn tại hoặc không thuộc kho hiện tại.'],
  PRODUCT_INVALID: ['请填写有效的物料信息，条码可留空；手动条码需为 3–64 位字母、数字或 ._-，单价最多四位小数且不能为负数，预警值需为非负数且最多 4 位小数。', 'Enter valid material information. Barcode is optional; a manual barcode must contain 3–64 letters, numbers or ._-. Unit prices must be non-negative with up to 4 decimal places, and the alert threshold must be non-negative with up to 4 decimal places.', 'Nhập thông tin vật tư hợp lệ. Có thể để trống mã vạch; mã vạch nhập tay phải gồm 3–64 chữ cái, chữ số hoặc ._-. Đơn giá và ngưỡng cảnh báo phải không âm, tối đa 4 chữ số thập phân.'],
  PRODUCT_NOT_FOUND: ['物料不存在。', 'Material not found.', 'Không tìm thấy vật tư.'],
  PRODUCT_WRONG_WAREHOUSE: ['物料不属于当前仓库。', 'The material does not belong to the current warehouse.', 'Vật tư không thuộc kho hiện tại.'],
  PRODUCT_QUANTITY_INVALID: ['数量需为正数且最多4位小数。', 'Quantity must be positive with up to 4 decimal places.', 'Số lượng phải dương và có tối đa 4 chữ số thập phân.'],
  ORDER_MISSING_ITEMS: ['请填写往来单位并至少添加一件物料。', 'Enter a business partner and add at least one material.', 'Nhập đối tác và thêm ít nhất một vật tư.'],
  ORDER_INVALID_QUANTITY_PRICE: ['物料数量必须为正数且最多 4 位小数，单价最多四位小数且不能为负数。', 'Material quantities must be positive with up to 4 decimal places. Unit prices must be non-negative with up to 4 decimal places.', 'Số lượng vật tư phải dương và có tối đa 4 chữ số thập phân. Đơn giá phải không âm và có tối đa 4 chữ số thập phân.'],
  ORDER_DUPLICATE_PRODUCT: ['同一物料不能重复添加，请合并数量。', 'The same material cannot be added twice. Combine the quantities.', 'Không thể thêm cùng vật tư hai lần. Vui lòng gộp số lượng.'],
  ORDER_ITEM_AMOUNT_TOO_LARGE: ['物料金额过大，请减少数量。', 'The material amount is too large. Reduce the quantity.', 'Thành tiền vật tư quá lớn. Vui lòng giảm số lượng.'],
  ORDER_AMOUNT_TOO_LARGE: ['单据金额过大，请减少数量或拆分单据。', 'The document amount is too large. Reduce quantities or split the document.', 'Tổng tiền chứng từ quá lớn. Vui lòng giảm số lượng hoặc tách chứng từ.'],
  STOCK_INSUFFICIENT: ['{name} 库存不足（当前 {stock} {unit}）。', 'Insufficient stock for {name} (current: {stock} {unit}).', 'Không đủ tồn kho cho {name} (hiện có: {stock} {unit}).'],
  STOCK_CHANGED: ['{name} 库存已变化，请刷新后重试。', 'Stock for {name} has changed. Refresh and try again.', 'Tồn kho của {name} đã thay đổi. Làm mới và thử lại.'],
  STOCK_OVERFLOW: ['{name} 入库后库存超出上限。', 'Stock for {name} would exceed the limit after receipt.', 'Tồn kho của {name} sẽ vượt giới hạn sau khi nhập.'],
  BUSINESS_FORBIDDEN: ['没有此业务操作的权限。', 'You do not have permission for this business action.', 'Bạn không có quyền thực hiện thao tác nghiệp vụ này.'],
  API_NOT_FOUND: ['接口不存在。', 'API endpoint not found.', 'Không tìm thấy điểm cuối API.'],
  RECORD_INVALID_ID: ['物料或单据编号无效。', 'Invalid material or document ID.', 'Mã vật tư hoặc chứng từ không hợp lệ.'],
  RECORD_WRONG_WAREHOUSE: ['该物料、单据或模板不属于当前仓库。', 'This material, document or template does not belong to the current warehouse.', 'Vật tư, chứng từ hoặc mẫu này không thuộc kho hiện tại.'],
  CATEGORY_WRONG_WAREHOUSE: ['该分类不属于当前仓库。', 'This category does not belong to the current warehouse.', 'Danh mục này không thuộc kho hiện tại.'],
};

export function serverTranslator(language = 'zh-CN') {
  const index = Math.max(0, supportedLanguages.indexOf(language));
  return (key, params = {}) => {
    const entry = serverMessages[key];
    if (!entry) throw new Error(`Missing server translation: ${key}`);
    const values = { ...params };
    if (key === 'CONTEXT_VALIDATION_FAILED') values.detail = localizeServerText(params.detail, language);
    for (const name of validationNestedParams[key] || []) if (Object.hasOwn(values, name)) values[name] = localizeServerText(values[name], language);
    return entry[index].replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
  };
}

const errorCodes = new Map(Object.entries(serverMessages).map(([code, messages]) => [messages[0], code]));
const parameterizedErrors = [
  [/^(.+) 库存不足（当前 (.+) (.*?)）。$/s, 'STOCK_INSUFFICIENT', ['name', 'stock', 'unit']],
  [/^(.+) 库存已变化，请刷新后重试。$/s, 'STOCK_CHANGED', ['name']],
  [/^(.+) 入库后库存超出上限。$/s, 'STOCK_OVERFLOW', ['name']],
];
export function serverErrorInfo(value) {
  const code = errorCodes.get(value);
  if (code) return { code, params: {} };
  for (const [pattern, code, fields] of parameterizedErrors) {
    const match = pattern.exec(value);
    if (match) return { code, params: Object.fromEntries(fields.map((key, index) => [key, match[index + 1]])) };
  }
  return validationErrorInfo(value);
}
export function localizeServerText(value, language) {
  const info = typeof value === 'string' ? serverErrorInfo(value) : null;
  return info ? serverTranslator(language)(info.code, info.params) : value;
}
export function installResponseLanguage(req, res, next) {
  const json = res.json;
  res.json = function (body) {
    if (body && typeof body.error === 'string') {
      const info = serverErrorInfo(body.error);
      const code = body.code || info?.code;
      if (code && serverMessages[code]) {
        const params = body.params || info?.params || {};
        body = { ...body, code, params, message: serverTranslator(requestLanguage(req))(code, params) };
      }
    }
    if (body && Array.isArray(body.errors)) body = { ...body, errors: body.errors.map(row => {
      if (!row || typeof row.error !== 'string') return row;
      const info = serverErrorInfo(row.error);
      return info ? { ...row, ...info, message: serverTranslator(requestLanguage(req))(info.code, info.params) } : row;
    }) };
    return json.call(this, body);
  };
  next();
}
