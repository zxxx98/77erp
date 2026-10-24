import { ConfigProvider as AntConfigProvider, Form as AntForm } from 'antd';
import { Button as AntButton, Input as AntInput, Checkbox as AntCheckbox } from '../ui/controls.jsx';

import { FormField } from './../ui/FormField.jsx';

import { useState, useRef, useEffect } from 'react';
import { downloadFile } from '../app/download.js';
import { Modal, ProductArt, Button } from '../components/common.jsx';
import { Barcode, ProductQualityCharts } from '../LazyComponents.jsx';
import { LoadingIndicator } from '../Loading.jsx';
import { Download, ScanLine, ImagePlus, Plus, Package, TriangleAlert, Check, Minus } from 'lucide-react';
import { usePermissions } from '../permissions.jsx';
import { api } from '../api.js';
import { evaluateStockExpression, describeStockExpression } from '../../shared/stock-compare.js';
import { price, count, stockStatus, currencySymbol } from '../app/format.js';
import { baseCurrency } from '../currency.js';
import { ProductHistory } from '../ProductHistory.jsx';
import { flattenCategories, readProductImage, categoryBranch } from '../catalog.js';
import { Select } from '../Dropdown.jsx';
import { ProductImage } from '../ProductImage.jsx';
import { ProductSync } from '../Warehouses.jsx';
import { ProductConflict } from '../ProductConflict.jsx';
import { useBusiness } from '../business-api.js';
import { parseQuantity, materialQuantity } from '../../shared/quantity.js';
import { mobileDevice } from '../device.js';
import { inspectionCycleLabel, inspectionUnits } from '../../shared/inspection.js';
import { CustomerPartNumbersEditor, CustomerPartNumbersDetail } from '../CustomerPartNumbers.jsx';
import { productionTypes } from '../../shared/product-production-type.js';

function ProductFormSection({ title, children }) {
  return mobileDevice ? <>{children}</> : <section className="drawer-form-section"><h3>{title}</h3>{children}</section>;
}

const productSnapshot = (form, targets) => JSON.stringify([
  ...['name', 'barcode', 'category', 'category_id', 'production_type', 'unit', 'cost', 'price', 'image', 'specification', 'note', 'threshold', 'is_fixed_asset', 'unit_round_up', 'inspection_date', 'inspection_interval', 'inspection_unit']
    .map(key => ['category_id', 'cost', 'price', 'threshold', 'inspection_interval'].includes(key) && form[key] !== '' && form[key] != null
      ? Number(form[key]) : ['is_fixed_asset', 'unit_round_up'].includes(key) ? (form[key] ? 1 : 0) : String(form[key] ?? '')),
  [...targets].sort((a, b) => a - b),
  (form.customer_part_numbers || []).map(row => [row.customer_id, row.part_number, !!row._editing]),
]);

function ProductCodeModal({ product, warehouseId, sourceId, onClose, notify, manageStockQr }) {
  const [format, setFormat] = useState("barcode");
  const [qr, setQr] = useState(null);
  const codeRef = useRef(null);
  useEffect(() => {
    setQr(null);
    if (format !== "qr") return;
    let alive = true;
    import("../product-code.js").then(({ productQrPayload, qrSymbol }) => {
      if (alive) setQr(qrSymbol(productQrPayload(product, product.warehouse_id ?? warehouseId, sourceId)));
    }).catch(error => {
      if (alive) setQr({ error: error.message || "二维码生成失败，请刷新后重试。" });
    });
    return () => { alive = false; };
  }, [format, product, warehouseId, sourceId]);
  const download = async () => {
    try {
      const svg = codeRef.current?.querySelector("svg");
      if (!svg) throw new Error("标签尚未生成，请重试。");
      await downloadFile(
        new XMLSerializer().serializeToString(svg),
        `${product.barcode}${format === "qr" ? "-qr" : ""}.svg`,
        "image/svg+xml",
      );
      notify(format === "qr" ? "二维码标签已下载" : "条码标签已下载");
    } catch (error) { notify(error.message); }
  };
  return (
    <Modal title="物料条码" subtitle="打印或下载物料标签" onClose={onClose} className="product-code-modal" headerActions={
      <div className="code-format-switch" role="group" aria-label="标签类型">
        <AntButton type="text" htmlType="button" aria-pressed={format === "barcode"} onClick={() => setFormat("barcode")}>条形码</AntButton>
        <AntButton type="text" htmlType="button" aria-pressed={format === "qr"} onClick={() => setFormat("qr")}>二维码</AntButton>
      </div>
    }>
      <div className="barcode-detail">
        <ProductArt product={product} size="large" />
        <h3>{product.name}</h3>
        <div ref={codeRef} className="product-code-symbol">
          {format === "barcode" ? <Barcode value={product.barcode} height={70} /> : !qr ? (
            <div className="product-qr-loading" role="status"><LoadingIndicator size={64} />正在生成二维码…</div>
          ) : qr.error ? (
            <div className="form-error" role="alert">{qr.error}</div>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="product-qr" width="256" height="256" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`二维码 ${product.barcode}`} shapeRendering="crispEdges">
              <title>{product.name} · {product.barcode}</title>
              <rect width={qr.size} height={qr.size} fill="#fff" />
              <path d={qr.path} fill="#000" />
            </svg>
          )}
        </div>
        {format === "qr" && <p className="product-code-number">{product.barcode}</p>}
        <p>{format === "qr" ? "包含物料编码、名称、单位和仓库信息" : `CODE 128 · ${product.category}`}</p>
      </div>
      <div className="modal-footer">
        {manageStockQr && <Button onClick={manageStockQr}>出入库二维码</Button>}
        <Button onClick={onClose}>关闭</Button>
        <Button kind="primary" icon={Download} disabled={format === "qr" && (!qr || !!qr.error)} onClick={download}>下载标签</Button>
      </div>
    </Modal>
  );
}

function ProductDetail({ product, data, warehouseName, onViewOrder, onClose, onViewBom }) {
  const { costs, can } = usePermissions();
  const [tab,setTab]=useState('details');
  const showQuality=!mobileDevice&&can('quality');
  const [others, setOthers] = useState(null);
  const [otherError, setOtherError] = useState("");
  useEffect(() => {
    let active = true;
    setOthers(null); setOtherError("");
    api(`/products/${product.id}/other-warehouses`)
      .then((result) => { if (active) setOthers(result.warehouses || []); })
      .catch((e) => { if (active) setOtherError(e.message); });
    return () => { active = false; };
  }, [product.id]);
  const expression = data?.settings?.stock_expression || null;
  const nameById = Object.fromEntries((data?.warehouses || []).map((w) => [w.id, w.name]));
  const stockByWarehouse = { ...(data?.warehouse_id != null ? { [data.warehouse_id]: Number(product.stock) || 0 } : {}) };
  for (const row of others ?? []) stockByWarehouse[row.warehouse_id] = Number(row.stock) || 0;
  const expressionValue = expression && others !== null ? evaluateStockExpression(expression, stockByWarehouse) : null;
  const expressionText = expression ? describeStockExpression(expression, nameById) : "";
  const fields = [
    ["物料条码", product.barcode],
    ["物料分类", product.category],
    ["计量单位", product.unit],
    ["所属仓库", warehouseName],
    ["参考销售价", `${currencySymbol()} ${price(product.price)}`],
    ...(costs ? [["参考采购价", `${currencySymbol()} ${price(product.cost)}`]] : []),
    ["当前库存", `${count(product.stock)} ${product.unit}`],
    ["安全库存", `${count(product.threshold)} ${product.unit}`],
    ["库存状态", stockStatus(product)],
    ["使用状态", product.active === 0 ? "已停用" : "已启用"],
    ["单位是否取整", product.unit_round_up ? "是" : "否"],
    ["固定资产", product.is_fixed_asset ? "是" : "否"],
    ["生产类型", product.production_type || "未设置"],
    ["下次校验日期", product.inspection_date || '未配置'],
    ["校验周期", inspectionCycleLabel(product)],
    ["上次校验", product.last_inspected_on || '暂无记录'],
  ];
  return <Modal title="物料详情" subtitle="查看物料档案与当前库存" onClose={onClose} presentation="drawer">
    <div className="form-body product-detail">
      <div className="product-detail-heading">
        <ProductArt product={product} size="large" />
        <h3>{product.name}</h3>
      </div>
      {showQuality&&<div className="product-quality-tabs" role="tablist" aria-label="物料详情视图">{[['details','物料信息'],['quality','品质图表']].map(([id,label])=><AntButton type="text" key={id} htmlType="button" role="tab" id={`product-tab-${id}`} aria-controls={`product-panel-${id}`} aria-selected={tab===id} onClick={()=>setTab(id)}>{label}</AntButton>)}</div>}
      {showQuality&&tab==='quality'?<div id="product-panel-quality" role="tabpanel" aria-labelledby="product-tab-quality"><ProductQualityCharts key={product.id} product={product} data={data}/></div>:<div id="product-panel-details" role={showQuality?'tabpanel':undefined} aria-labelledby={showQuality?'product-tab-details':undefined}>
      <dl className="product-detail-fields">
        {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}
        <div className="product-detail-full"><dt>规格型号</dt><dd>{product.specification || "—"}</dd></div>
        <div className="product-detail-full"><dt>备注</dt><dd>{product.note || "—"}</dd></div>
      </dl>
      <CustomerPartNumbersDetail value={product.customer_part_numbers} />
      <ProductHistory key={product.id} product={product} onViewOrder={onViewOrder} />
      <section className="product-other-stock">
        <h4>其他仓库库存</h4>
        {otherError ? <p className="form-error" role="alert">{otherError}</p>
          : others === null ? <p className="product-other-empty"><LoadingIndicator size={20} /> 读取中…</p>
          : others.length === 0 ? <p className="product-other-empty">其他仓库暂无同一物料</p>
          : <ul className="product-other-list">
            {others.map((row) => <li key={row.warehouse_id}>
              <span>{row.warehouse_name}</span>
              <strong>{count(row.stock)} {row.unit || product.unit}</strong>
            </li>)}
          </ul>}
        {expressionValue !== null && (
          <div className="product-stock-total">
            <div className={`product-stock-total-sum stock-diff-${expressionValue > 0 ? "positive" : expressionValue < 0 ? "negative" : "zero"}`}>
              <span title={expressionText}>{expressionText}</span>
              <strong>{`${expressionValue > 0 ? "+" : ""}${count(expressionValue)}`} {product.unit}</strong>
            </div>
          </div>
        )}
      </section>
      </div>}
    </div>
    <div className="modal-footer">{can('bom') && onViewBom && <Button onClick={onViewBom}>查看BOM</Button>}<Button onClick={onClose}>关闭</Button></div>
  </Modal>;
}

function ProductForm({ product, categories, units = ["个"], warehouses, warehouseId, onClose, onSaved }) {
  const [syncTargets, setSyncTargets] = useState([]);
  const [currentCategories, setCurrentCategories] = useState(categories);
  const options = flattenCategories(currentCategories);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState(null);
  const [form, setForm] = useState(
    product || {
      name: "",
      barcode: "",
      category: options[0]?.path || "",
      category_id: options[0]?.id || "",
      image: "",
      specification: "",
      note: "",
      unit: units[0],
      cost: "",
      price: "",
      threshold: 20,
      is_fixed_asset: 0,
      unit_round_up: 0,
      production_type: '',
      inspection_date: '', inspection_interval: 0, inspection_unit: 'month',
    },
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const [readingImage, setReadingImage] = useState(false);
  const imageInputRef = useRef(null);
  const errorRef = useRef(null);
  const baseline = useRef(productSnapshot(form, []));
  const close = () => {
    if (busy || readingImage) return;
    if (!mobileDevice && productSnapshot(form, syncTargets) !== baseline.current &&
      !window.confirm('物料信息尚未保存，确定放弃修改并关闭？')) return;
    onClose();
  };
  useEffect(() => {
    if (!mobileDevice && error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error, conflict]);
  const submit = async () => {

    if (busy || readingImage || conflict) return;
    setBusy(true);
    setError("");
    try {
      if (form.customer_part_numbers?.some(row => row._editing)) throw new Error('请先点击勾选确认客户料号，或移除未录入的条目。');
      const result = await api(
        product ? `/products/${product.id}` : "/products",
        {
          method: product ? "PUT" : "POST",
          body: {
            ...form,
            customer_part_numbers: (form.customer_part_numbers || []).map(({ customer_id, part_number }) => ({ customer_id, part_number })),
            cost: Number(form.cost),
            price: Number(form.price),
            threshold: Number(form.threshold),
            is_fixed_asset: form.is_fixed_asset ? 1 : 0,
            unit_round_up: form.unit_round_up ? 1 : 0,
            inspection_interval: Number(form.inspection_interval || 0),
            sync_warehouse_ids: syncTargets,
          },
        },
      );
      baseline.current = productSnapshot(form, syncTargets);
      await onSaved(
        product ? "物料信息已更新" : `物料已创建 · 条码 ${result.barcode}`,
      );
    } catch (e) {
      setError(e.message);
      if (e.status === 409 && e.code === 'PRODUCT_VERSION_CONFLICT') {
        setConflict(true);
        setLatest(null);
      }
    } finally {
      setBusy(false);
    }
  };
  const priceFields = (
    <>
      <label>
        参考采购价（{baseCurrency()}） <span>*</span>
        <FormField value={form.cost} required type="number" min="0" max="99999999" label="参考采购价（ ）"><AntInput
          type="number"
          min="0"
          max="99999999"
          step="0.0001"
          placeholder="0.0000"
          value={form.cost}
          onChange={(e) => change("cost", e.target.value)}
        /></FormField>
      </label>
      <label>
        参考销售价（{baseCurrency()}） <span>*</span>
        <FormField value={form.price} required type="number" min="0" max="99999999" label="参考销售价（ ）"><AntInput
          type="number"
          min="0"
          max="99999999"
          step="0.0001"
          placeholder="0.0000"
          value={form.price}
          onChange={(e) => change("price", e.target.value)}
        /></FormField>
      </label>
    </>
  );
  const specificationField = (
    <label>规格型号
      <AntInput maxLength={500} placeholder="例如：3 芯 / 1.5 mm² / 额定电压 300/500V" value={form.specification || ''} onChange={e => change('specification', e.target.value)} />
    </label>
  );
  return (
    <Modal
      title={product ? "编辑物料" : "新增物料"}
      subtitle="填写物料信息；条码选填，新增时留空自动生成"
      onClose={close}
      presentation="drawer"
    >
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={submit}>
        <div className="form-body">
          <ProductFormSection title="基础信息">
            <label>
              物料名称 <span>*</span>
              <FormField label="物料名称" value={form.name} required maxLength={100}><AntInput

                data-autofocus
                maxLength={100}
                placeholder="例如：RVV 护套电线"
                value={form.name}
                onChange={(e) => change("name", e.target.value)}
              /></FormField>
            </label>
            <label>
              物料条码（选填）
              <div className="input-with-icon">

                <FormField value={form.barcode} maxLength={64} pattern="[A-Za-z0-9_.\-]{3,64}" label="物料条码（选填）"><AntInput prefix={<ScanLine size={17} />}
                  pattern="[A-Za-z0-9_.\-]{3,64}"
                  maxLength={64}
                  title="3–64 位字母、数字或 ._-"
                  placeholder="扫描或输入条码，可留空"
                  value={form.barcode}
                  onChange={(e) => change("barcode", e.target.value)}
                /></FormField>
              </div>
              <small>
                {product
                  ? "可扫描或手动输入条码；留空保存将保留当前条码。"
                  : "可扫描或手动输入条码；留空保存时自动生成唯一条码。"}
              </small>
            </label>
            <div className="form-grid">
              <label>
                物料分类 <span>*</span>
                <Select aria-label="物料分类"
                  required
                  value={form.category_id || ''}
                  onChange={(e) => {
                    const c = options.find(c => c.id === Number(e));
                    setForm(current => ({ ...current, category_id: c?.id || '', category: c?.path || '' }));
                  }}
                >
                  <option value="" disabled>请选择分类</option>
                  {options.map(c => <option key={c.id} value={c.id}>{'　'.repeat(c.depth)}{c.path}</option>)}
                </Select>
                {!options.length && <small>请先在物料管理的「管理分类」中添加分类。</small>}
              </label>
              <label>
                计量单位 <span>*</span>
                <Select aria-label="计量单位"
                  required
                  value={form.unit}
                  onChange={(e) => change("unit", e)}
                >
                  {[...new Set([...units, form.unit])].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
                <small>可在「设置 → 基础设置 → 计量单位」中配置。</small>
              </label>
              {mobileDevice && priceFields}
            </div>
            <label>
              生产类型
              <Select aria-label="生产类型" value={form.production_type || ''} onChange={value => change('production_type', value)}>
                <option value="">未设置</option>
                {productionTypes.map(type => <option key={type} value={type}>{type}</option>)}
              </Select>
            </label>
            <AntCheckbox className="product-fixed-asset" checked={!!form.unit_round_up} onChange={e => change('unit_round_up', e.target.checked ? 1 : 0)}>
              单位是否取整
              <small>勾选后数量向上取整，例如 4.1 个按 5 个计算；BOM 配方单耗仍可填写小数或分数。</small>
            </AntCheckbox>
            <AntCheckbox className="product-fixed-asset" checked={!!form.is_fixed_asset} onChange={(e) => change("is_fixed_asset", e.target.checked ? 1 : 0)}>

              固定资产
              <small>勾选后该物料标记为固定资产，导出时可选择只导出固定资产。</small>
            </AntCheckbox>
            {!mobileDevice && specificationField}
          </ProductFormSection>
          <div className="drawer-form-section">
            <CustomerPartNumbersEditor value={form.customer_part_numbers} onChange={value => change('customer_part_numbers', value)} disabled={busy || conflict} />
          </div>
          <ProductFormSection title="图片与说明">
            <div className="product-image-editor" role="group" aria-label="物料图片">
              <div className="product-image-label">物料图片</div>
              <input ref={imageInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || readingImage} aria-label="上传物料图片"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setReadingImage(true); setError('');
                    try { change('image', await readProductImage(file)); }
                    catch (e) { setError(e.message); }
                    finally { setReadingImage(false); }
                  }} />
              <AntButton type="text" htmlType="button" className="product-image-upload" disabled={busy || readingImage} aria-busy={readingImage} onClick={() => imageInputRef.current?.click()}>
                <span className="product-image-upload-icon" aria-hidden="true">{readingImage ? <LoadingIndicator size={22} /> : <ImagePlus size={22} />}</span>
                <span className="product-image-upload-copy">
                  <strong>{readingImage ? '正在上传图片…' : form.image ? '更换物料图片' : '上传物料图片'}</strong>
                  <span>{readingImage ? '正在压缩并上传，请稍候' : '点击选择图片，支持 JPEG、PNG、WebP'}</span>
                </span>
                {!readingImage && <Plus size={18} aria-hidden="true" />}
              </AntButton>
              <small className="product-image-hint">单张图片不超过 10 MB，上传时自动压缩。</small>
              {form.image && <div className="product-image-preview"><ProductImage src={form.image} alt="物料图片预览" className="product-image-thumbnail" /><Button type="button" disabled={busy || readingImage} onClick={() => change('image', '')}>移除图片</Button></div>}
            </div>
            {mobileDevice && specificationField}
            <label>物料备注
              <AntInput.TextArea maxLength={2000} rows={3} placeholder="填写物料补充说明" value={form.note || ''} onChange={e => change('note', e.target.value)} />
            </label>
          </ProductFormSection>
          <ProductFormSection title="价格与库存设置">
            {!mobileDevice && <div className="form-grid">{priceFields}</div>}
            <label>
              安全库存 <span>*</span>
              <FormField label="安全库存" value={form.threshold} required type="number" min="0" max="99999999"><AntInput
                type="number"
                min="0"
                max="99999999"
                step="0.0001"
                value={form.threshold}
                onChange={(e) => change("threshold", e.target.value)}
              /></FormField>
              <small>设为 0 则不启用缺货和低库存预警；大于 0 时，库存小于或等于此数量会提醒补货。</small>
            </label>
          </ProductFormSection>
          <ProductFormSection title="校验提醒（可选）">
            <label>下次校验日期
              <AntInput type="date" aria-label="下次校验日期" value={form.inspection_date || ''} onChange={e => {
                change('inspection_date', e.target.value);
                if (!e.target.value) change('inspection_interval', 0);
              }} />
              <small>到期当天起在首页显示待校验物料；留空不提醒。</small>
            </label>
            <div className="form-grid">
              <label>校验周期
                <FormField value={form.inspection_interval || ''} type="number" min="1" max="999" label="校验周期"><AntInput type="number" aria-label="校验周期" min="1" max="999" step="1" disabled={!form.inspection_date} placeholder="留空则手动设置日期" value={form.inspection_interval || ''} onChange={e => change('inspection_interval', e.target.value)} /></FormField>
              </label>
              <label>周期单位
                <Select className="inspection-unit-select" aria-label="周期单位" disabled={!form.inspection_date} value={form.inspection_unit || 'month'} onChange={e => change('inspection_unit', e)}>
                  {Object.entries(inspectionUnits).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Select>
              </label>
            </div>
            <small>点击「已校验」后可选择实际校验日期（默认今天），按配置周期计算下次日期；未设置周期时，需手动填写下次日期。</small>
          </ProductFormSection>
          <ProductFormSection title="同步到其他仓库">
            <ProductSync warehouses={warehouses} warehouseId={warehouseId} targets={syncTargets} setTargets={setSyncTargets} disabled={busy || readingImage} />
          </ProductFormSection>
          {!product && (
            <div className="info-box">
              <Package size={17} />
              <p>新物料初始库存为 0，创建后通过「入库」增加库存。</p>
            </div>
          )}
          {error && (
            <div ref={errorRef} className="form-error" role="alert">
              <TriangleAlert size={16} />
              {error}
            </div>
          )}
          {conflict && <>
            <ProductConflict form={form} latest={latest?.product} />
            <Button type="button" disabled={busy || readingImage} onClick={async () => {
              setBusy(true);
              setLatest(null);
              try {
                const [data, detail] = await Promise.all([api('/workspace', { warehouseId }), api(`/products/${product.id}`, { warehouseId })]);
                const current = detail.product;
                if (!current) throw new Error('物料已被删除，当前填写内容已保留。');
                setLatest({ product: current, categories: data.categories });
              } catch (e) { setError(e.message); }
              finally { setBusy(false); }
            }} busy={busy}>{busy ? '正在读取…' : '查看最新信息'}</Button>
            {latest && <Button type="button" disabled={busy || readingImage} onClick={() => {
              if (!window.confirm('使用最新信息替换当前填写内容，并清空同步仓库选择？')) return;
              setForm(latest.product);
              baseline.current = productSnapshot(latest.product, []);
              setCurrentCategories(latest.categories);
              setSyncTargets([]);
              setConflict(false);
              setLatest(null);
              setError('');
            }}>使用最新信息重新编辑</Button>}
          </>}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={close} disabled={busy || readingImage}>
            取消
          </Button>
          <Button
            type="submit"
            kind="primary"
            icon={Check} busy={busy}
            disabled={busy || readingImage || conflict}
          >
            {busy ? "正在保存…" : "保存物料"}
          </Button>
        </div>
      </AntForm>
    </Modal>
  );
}

function CategoryManager({ categories, onClose, onChanged }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = flattenCategories(categories);
  const excluded = categoryBranch(categories, Number(id));
  const choose = value => {
    const c = categories.find(c => c.id === Number(value));
    setId(value); setName(c?.name || ''); setParent(c?.parent_id || ''); setError('');
  };
  const run = async action => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await onChanged(); choose(''); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <Modal title="管理物料分类" subtitle="建立多级分类；选择上级分类即可添加子分类。" onClose={busy ? () => {} : onClose}>
    <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={() => {  void run(() => api(id ? `/categories/${id}` : '/categories', { method: id ? 'PUT' : 'POST', body: { name, parent_id: parent ? Number(parent) : null } })); }}>
      <AntConfigProvider componentDisabled={busy}><fieldset className="form-body category-form" disabled={busy}>
        <label>编辑分类<Select aria-label="编辑分类" value={id} onChange={e => choose(e)}><option value="">新增分类</option>{options.map(c => <option key={c.id} value={c.id}>{c.path}</option>)}</Select></label>
        <label>分类名称 <span>*</span><FormField label="分类名称" value={name} required maxLength={100}><AntInput  maxLength={100} value={name} placeholder="例如：电线" onChange={e => setName(e.target.value)} /></FormField></label>
        <label>上级分类<Select aria-label="上级分类" value={parent} onChange={e => setParent(e)}><option value="">无（一级分类）</option>{options.filter(c => !excluded.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.path}</option>)}</Select></label>
        <small className="muted">选中父分类会包含下级物料。删除前需移走该分类的下级分类及物料。</small>
        {error && <div className="form-error" role="alert">{error}</div>}
      </fieldset></AntConfigProvider>
      <div className="modal-footer">
        {id && <Button type="button" disabled={busy} onClick={() => { if (window.confirm(`确定删除分类「${name}」？`)) void run(() => api(`/categories/${id}/delete`, { method: 'POST', body: {} })); }}>删除分类</Button>}
        <Button type="button" disabled={busy} onClick={onClose}>完成</Button>
        <Button type="submit" kind="primary" busy={busy}>{busy ? '正在保存…' : '保存分类'}</Button>
      </div>
    </AntForm>
  </Modal>;
}

function ReduceStockModal({ product, increase = false, onClose, onSaved }) {
  const action = increase ? '增加' : '减少';
  const { busy, error, run, send } = useBusiness();
  const [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState("");
  const submit = () => {

    run(async () => {
      const amount = materialQuantity(parseQuantity(quantity, true), product);
      if (!reason.trim()) throw new Error(`请填写${action}原因。`);
      if (!increase && amount > product.stock)
        throw new Error(`减少数量不能超过现有库存 ${product.stock} ${product.unit}。`);
      if (
        !window.confirm(
          `确认将「${product.name}」库存从 ${product.stock} ${action} ${amount} ${product.unit}？`,
        )
      )
        return;
      await send(increase ? "/stock/increase" : "/stock/reduce", {
        product_id: product.id,
        quantity: amount,
        expected_stock: product.stock,
        reason,
      });
      await onSaved(`库存已${action} · ${product.name}`);
    });
  };
  return (
    <Modal
      title={increase ? "增加库存（退料）" : "减少库存"}
      subtitle={increase ? "用于生产余料退回，直接增加库存并记录原因。按当前库存平均成本计价，零库存时使用参考采购价。" : "用于报损、损耗或盘亏，直接调整现有库存并记录原因。"}
      onClose={busy ? () => {} : onClose}
    >
      <AntForm noValidate layout="vertical" scrollToFirstError={{ focus: true }} onFinish={submit}>
        <div className="form-body">
          <div className="reduce-stock-product">
            <strong>{product.name}</strong>
            <small>
              {product.barcode} · 现有库存 {product.stock} {product.unit}
            </small>
          </div>
          <label>
            {action}数量（{product.unit}） <span>*</span>
            <FormField label="数量（ ）" value={quantity} required type="number" min="0.0001"><AntInput

              data-autofocus
              type="number"
              min="0.0001"
              step="0.0001"
              placeholder="0"
              value={quantity}
              disabled={busy}
              onChange={(e) => setQuantity(e.target.value)}
            /></FormField>
          </label>
          <label>
            {action}原因 <span>*</span>
            <FormField label="原因" value={reason} required maxLength={500}><AntInput

              maxLength={500}
              placeholder={increase ? "例如：生产余料退回" : "例如：破损报废、盘点损耗"}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            /></FormField>
          </label>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" kind="primary" icon={increase ? Plus : Minus} busy={busy}>
            {busy ? "处理中…" : `确认${action}`}
          </Button>
        </div>
      </AntForm>
    </Modal>
  );
}

export { ProductCodeModal, ProductDetail, ProductForm, CategoryManager, ReduceStockModal };
