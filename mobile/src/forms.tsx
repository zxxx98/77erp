import React, { useEffect, useRef, useState } from "react";
import { Alert, Linking, Switch, Text, View } from "react-native";
import { Camera, Check, Minus, Plus, Trash2 } from "lucide-react-native";
import { ProductImage } from "./ProductImage";
import { ProductConflict } from './ProductConflict';
import { TemplateList } from "./commerce";
import { UpdateCard } from "./UpdateCard";
import { api, device, getWarehouseId, scanBarcode, uploadProductImage } from "./native";
import { ImagebedSettings } from './ImagebedSettings';
import { parseProductCode, resolveProductCode } from "./product-scan";
import {
  Category,
  flattenCategories,
  addLine,
  Contact,
  Template,
  Line,
  matchesProduct,
  money,
  orderPayload,
  orderTotal,
  Product,
  ProductForm,
  productPayload,
  Settings,
  Warehouse,
  Workspace,
} from "./model";
import {
  Button,
  Chips,
  Card,
  Columns,
  useFormError,
  Field,
  IconButton,
  ProductRow,
  ScreenModal,
  SearchField,
  s,
  useSubmitLock,
} from "./ui";

export function ProductEditor({
  product,
  categories = [],
  units = ["件"],
  warehouses = [],
  warehouseId = 1,
  onClose,
  onSaved,
}: {
  product?: Product;
  categories?: Category[];
  units?: string[];
  warehouses?: Warehouse[];
  warehouseId?: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [currentCategories, setCurrentCategories] = useState(categories);
  const options = flattenCategories(currentCategories);
  const selected = options.find(c => c.id === product?.category_id) || options[0];
  const initial: ProductForm = {
    name: product?.name ?? "",
    barcode: product?.barcode ?? "",
    category: product?.category ?? selected?.path ?? "",
    category_id: String(product?.category_id ?? selected?.id ?? ""),
    image: product?.image ?? "",
    specification: product?.specification ?? "",
    note: product?.note ?? "",
    unit: product?.unit ?? units[0] ?? "件",
    cost: String(product?.cost ?? 0),
    price: String(product?.price ?? 0),
    threshold: String(product?.threshold ?? 5),
  };
  const [form, setForm] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [version, setVersion] = useState(product?.version);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<{ product: Product; categories: Category[] }>();
  const [syncTargets, setSyncTargets] = useState<number[]>([]);
  const { error, errorRevision, setError } = useFormError();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const lock = useSubmitLock();
  const field = (key: keyof ProductForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (pickingImage || scanning || conflict) return;
    if (!lock.enter()) return;
    setBusy(true);
    setError("");
    try {
      const payload = productPayload(form);
      await api(
        product ? `/products/${product.id}` : "/products",
        product ? "PUT" : "POST",
        { ...payload, ...(product ? { version } : {}), sync_warehouse_ids: syncTargets },
      );
      onSaved(product ? "商品已更新" : "商品已创建，初始库存为 0");
    } catch (e) {
      setError((e as Error).message);
      const failure = e as { status?: number; code?: string };
      if (failure.status === 409 && failure.code === 'PRODUCT_VERSION_CONFLICT') {
        setConflict(true);
        setLatest(undefined);
      }
    } finally {
      setBusy(false);
      lock.leave();
    }
  };
  const scan = async () => {
    setScanning(true);
    setError("");
    try {
      const code = await scanBarcode();
      // A product label fills in its barcode; the rest of the label is not product data.
      if (code) field("barcode")(parseProductCode(code).barcode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };
  return (
    <ScreenModal
      title={product ? "编辑商品" : "新增商品"}
      onClose={onClose}
      error={error}
      errorRevision={errorRevision}
      dirty={JSON.stringify(form) !== JSON.stringify(baseline) || syncTargets.length > 0}
      busy={busy || scanning || pickingImage}
      footer={
        <Button
          title="保存商品"
          icon={Check}
          busy={busy}
          disabled={scanning || pickingImage || conflict}
          onPress={save}
        />
      }
    >
      {conflict && <>
        <ProductConflict form={form} latest={latest?.product} />
        <Button title="查看最新信息" kind="secondary" disabled={busy || scanning || pickingImage} onPress={async () => {
          if (!product || !lock.enter()) return;
          setBusy(true);
          setLatest(undefined);
          try {
            const data = await api<Workspace>('/data', 'GET', undefined, warehouseId);
            const current = data.products.find(p => p.id === product.id);
            if (!current) throw new Error('商品已被删除，当前填写内容已保留。');
            setLatest({ product: current, categories: data.categories || [] });
          } catch (e) { setError((e as Error).message); }
          finally { setBusy(false); lock.leave(); }
        }} />
        {!!latest && <Button title="使用最新信息重新编辑" kind="secondary" disabled={busy || scanning || pickingImage} onPress={() => {
          Alert.alert('使用最新商品信息', '使用最新信息替换当前填写内容，并清空同步仓库选择？', [
            { text: '取消', style: 'cancel' },
            { text: '重新编辑', onPress: () => {
              const current = latest.product;
              const next: ProductForm = {
                name: current.name, barcode: current.barcode, category: current.category,
                category_id: String(current.category_id ?? ''), unit: current.unit,
                cost: String(current.cost), price: String(current.price), threshold: String(current.threshold),
                image: current.image || '', specification: current.specification || '', note: current.note || '',
              };
              setForm(next); setBaseline(next); setVersion(current.version);
              setCurrentCategories(latest.categories); setSyncTargets([]);
              setConflict(false); setLatest(undefined); setError('');
            } },
          ]);
        }} />}
      </>}
      <Card>
        <Field
          label="商品名称"
          value={form.name}
          onChangeText={field("name")}
          maxLength={100}
          editable={!busy}
          placeholder="例如：马克杯"
        />
        <Field
          label="商品条码（选填）"
          value={form.barcode}
          onChangeText={field("barcode")}
          maxLength={64}
          autoCapitalize="none"
          editable={!busy}
          placeholder="留空自动生成"
        />
        <Button
          title="扫描商品条码"
          icon={Camera}
          kind="secondary"
          onPress={scan}
          busy={scanning}
          disabled={busy || pickingImage}
        />
        <Text style={s.caption}>
          {product
            ? "编辑时留空将保留原条码。"
            : "商品库存从 0 开始，通过采购入库增加库存。"}
        </Text>
        <Text style={s.label}>商品分类</Text>
        <Chips value={form.category_id || ''} options={options.map(c => ({ id: String(c.id), label: c.path }))} onChange={value => {
          const c = options.find(c => String(c.id) === value);
          setForm(current => ({ ...current, category_id: value, category: c?.path || '' }));
        }} />
        {!options.length && <Text style={s.caption}>请先在商品页面的「管理分类」中添加分类。</Text>}
        <Columns>
          <Field
            label="单位"
            value={form.unit}
            onChangeText={field("unit")}
            maxLength={100}
            editable={!busy}
          />
        </Columns>
        <Chips value={form.unit} options={[...new Set([...units, ...(product ? [product.unit] : [])])].map(unit => ({ id: unit, label: unit }))} onChange={unit => { if (!busy) field("unit")(unit); }} />
        <Text style={s.caption}>可选择已配置的单位，也可输入。常用单位在「设置 → 计量单位」中管理。</Text>
      </Card>
      <Card>
        <Text style={s.label}>商品图片</Text>
        {!!form.image && <ProductImage uri={form.image} label="商品图片预览" style={{ width: '100%', height: 180, borderRadius: 8 }} />}
        <Button title="选择商品图片" kind="secondary" busy={pickingImage} disabled={busy || scanning} onPress={async () => {
          setPickingImage(true); setError('');
          try { const uri = await device.pickImage(); if (uri) field('image')(await uploadProductImage(uri)); }
          catch (e) { setError((e as Error).message); }
          finally { setPickingImage(false); }
        }} />
        {!!form.image && <Button title="移除图片" kind="secondary" disabled={busy || pickingImage} onPress={() => field('image')('')} />}
        <Text style={s.caption}>自动压缩并转为 WebP 上传图床。</Text>
        <Field label="商品规格" value={form.specification} onChangeText={field('specification')} maxLength={500} editable={!busy} placeholder="例如：白色 / 350ml / 12个装" />
        <Field label="商品备注" value={form.note} onChangeText={field('note')} maxLength={2000} multiline numberOfLines={3} editable={!busy} placeholder="填写商品补充说明" />
      </Card>
      <Card>
        <Field
          label="采购价"
          value={form.cost}
          onChangeText={field("cost")}
          keyboardType="decimal-pad"
          editable={!busy}
        />
        <Field
          label="销售价"
          value={form.price}
          onChangeText={field("price")}
          keyboardType="decimal-pad"
          editable={!busy}
        />
        <Field
          label="安全库存"
          value={form.threshold}
          onChangeText={field("threshold")}
          keyboardType="number-pad"
          editable={!busy}
        />
      </Card>
      <Card>
        <Text style={s.subtitle}>同步到其他仓库（选填）</Text>
        <Text style={s.caption}>本次保存同步商品档案和参考价格，已有库存和成本保留，新商品库存为 0。未选择的仓库保留原档案。</Text>
        {warehouses.filter(w => w.id !== warehouseId).map(w => <View key={w.id} style={s.row}>
          <Text style={[s.label, s.grow]}>{w.name}</Text>
          <Switch accessibilityLabel={`同步到${w.name}`} value={syncTargets.includes(w.id)} disabled={busy || scanning || pickingImage} onValueChange={checked => setSyncTargets(current => checked ? [...current, w.id] : current.filter(id => id !== w.id))} />
        </View>)}
        {warehouses.length < 2 && <Text style={s.caption}>请先在商户与仓库设置中新增仓库。</Text>}
      </Card>
    </ScreenModal>
  );
}

export function OrderEditor({
  type,
  products,
  initialProduct,
  initialTemplate,
  contacts = [],
  warehouseId,
  sourceId,
  onClose,
  onSaved,
}: {
  type: "in" | "out";
  products: Product[];
  initialProduct?: Product;
  initialTemplate?: Template;
  contacts?: Contact[];
  warehouseId?: number;
  sourceId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [template, setTemplate] = useState(initialTemplate);
  const [templateName, setTemplateName] = useState(initialTemplate?.name || "");
  const [templateMessage, setTemplateMessage] = useState("");
  const [templatePicker, setTemplatePicker] = useState(false);
  const [templateRevision, setTemplateRevision] = useState(0);
  const [partner, setPartner] = useState(initialTemplate?.partner ?? (type === "out" ? "零售客户" : ""));
  const [partnerId, setPartnerId] = useState<number|null>(initialTemplate?.partner_id ?? null);
  const [note, setNote] = useState(initialTemplate?.note || "");
  const templateRequest = useRef({key:"",id:""});
  const orderRequest = useRef({key:"",id:""});
  const missingTemplateProduct = template?.items.some(i => !products.some(p => p.id === i.product_id));
  const [lines, setLines] = useState<Line[]>(() =>
    initialTemplate ? initialTemplate.items.flatMap(i => { const product=products.find(p=>p.id===i.product_id);return product ? [{product,quantity:String(i.quantity),price:String(i.price)}] : []; }) : initialProduct ? addLine([], initialProduct, type) : [],
  );
  const [query, setQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const { error, errorRevision, setError } = useFormError();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const lock = useSubmitLock();
  const add = (product: Product) => {
    try {
      setLines(addLine(lines, product, type));
      setQuery("");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const update = (id: number, key: "quantity" | "price", value: string) =>
    setLines((current) =>
      current.map((line) =>
        line.product.id === id ? { ...line, [key]: value } : line,
      ),
    );
  const scan = async () => {
    setScanning(true);
    setError("");
    try {
      const code = await scanBarcode();
      if (code) {
        const product = resolveProductCode(code, { products, warehouseId, sourceId });
        if (!product)
          throw new Error(`未找到条码「${code.trim()}」，请先建立商品档案。`);
        add(product);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  };
  const submit = async () => {
    if (!lock.enter()) return;
    setBusy(true);
    setError("");
    try {
      if (missingTemplateProduct) throw new Error("模板商品已变化，请刷新后重新打开。");
      const payload = {...orderPayload(type, partner, note, lines), ...(partnerId ? {partner_id:partnerId} : {})};
      const key = JSON.stringify(payload);
      if (orderRequest.current.key !== key) orderRequest.current = { key, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      const result = await api<{ number: string }>("/orders", "POST", { ...payload, request_id: orderRequest.current.id });
      // Close immediately after the mutation succeeds; a refresh error must not allow resubmission.
      onSaved(`单据 ${result.number} 已保存`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.leave();
    }
  };
  const saveTemplate = async (overwrite = false) => {
    if (!lock.enter()) return;
    setBusy(true); setError(""); setTemplateMessage("");
    try {
      if (missingTemplateProduct) throw new Error("模板商品已变化，请刷新后重新打开。");
      const body = { ...(overwrite && template ? { id: template.id, version: template.version } : {}), name: templateName, type, partner, partner_id: partnerId, note, items: lines.map(i => ({ product_id: i.product.id, quantity: i.quantity, price: i.price })) };
      const key = JSON.stringify(body);
      if (templateRequest.current.key !== key) templateRequest.current = { key, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      const result = await api<Template>("/templates", "POST", { ...body, request_id: templateRequest.current.id });
      templateRequest.current = { key: "", id: "" };
      setTemplate(result); setTemplateName(result.name); setTemplateRevision(value => value + 1);
      setTemplateMessage(`模板「${result.name}」已保存，可反复套用`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); lock.leave(); }
  };
  const useTemplate = (selected: Template) => {
    const apply = () => {
      if (selected.items.some(i => !products.some(p => p.id === i.product_id))) { setError("模板商品已变化，请刷新后重新选择。"); return; }
      setTemplate(selected); setTemplateName(selected.name); setTemplateMessage("");
      setPartner(selected.partner); setPartnerId(selected.partner_id); setNote(selected.note);
      setLines(selected.items.map(i => ({ product: products.find(p => p.id === i.product_id)!, quantity: String(i.quantity), price: String(i.price) })));
      setTemplatePicker(false); setError("");
    };
    if (lines.length || note || (partner && partner !== "零售客户")) Alert.alert("套用模板？", "将替换当前编辑内容。", [{ text: "取消", style: "cancel" }, { text: "确认套用", onPress: apply }]);
    else apply();
  };
  const confirm = () => {
    try {
      if (missingTemplateProduct) throw new Error("模板商品已变化，请刷新后重新打开。");
      orderPayload(type, partner, note, lines);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    Alert.alert(
      type === "in" ? "确认采购入库？" : "确认销售出库？",
      `${lines.length} 种商品，合计 ${money(orderTotal(lines))}。确认后立即更新库存。`,
      [
        { text: "继续编辑", style: "cancel" },
        { text: "确认提交", onPress: submit },
      ],
    );
  };
  const matches = query.trim()
    ? products.filter((product) => (includeInactive || product.active !== 0) && matchesProduct(product, query)).slice(0, 20)
    : [];
  return (
    <ScreenModal
      title={type === "in" ? "采购入库" : "销售出库"}
      onClose={onClose}
      error={error}
      errorRevision={errorRevision}
      dirty={
        !!lines.length || !!note || (partner !== "" && partner !== "零售客户")
      }
      busy={busy || scanning}
      footer={
        <>
          <View style={s.between}>
            <Text style={s.caption}>{lines.length} 种商品</Text>
            <Text style={s.subtitle}>{money(orderTotal(lines))}</Text>
          </View>
          <Button
            title={type === "in" ? "确认入库" : "确认出库"}
            icon={Check}
            busy={busy}
            disabled={!lines.length || scanning}
            onPress={confirm}
          />
        </>
      }
    >
      <Button title="选择单据模板" kind="secondary" disabled={busy || scanning} onPress={() => setTemplatePicker(!templatePicker)} />
      {templatePicker && <TemplateList type={type} disabled={busy || scanning} refreshKey={templateRevision} onUse={useTemplate} />}
      {template && <Text style={s.caption}>已套用「{template.name}」，本次修改不会自动更新模板。</Text>}
      <Card>
        <Field label="模板名称" placeholder="例如：每周日用品补货" value={templateName} maxLength={100} editable={!busy && !scanning} onChangeText={setTemplateName} />
        <Button title={template ? "另存为模板" : "保存为模板"} kind="secondary" disabled={busy || scanning || !lines.length} onPress={() => void saveTemplate()} />
        {template && <Button title="更新模板" kind="secondary" disabled={busy || scanning || !lines.length} onPress={() => void saveTemplate(true)} />}
        {!!templateMessage && <Text style={s.caption} accessibilityRole="text">{templateMessage}</Text>}
      </Card>
      <Field
        label={type === "in" ? "供应商" : "客户"}
        placeholder={type === "in" ? "必填：请输入供应商名称" : "必填：请输入客户名称"}
        value={partner}
        onChangeText={value => {setPartner(value);setPartnerId(null);}}
        maxLength={100}
        editable={!busy}
      />
      {contacts.filter(c=>c.active&&c.role===(type==="in"?"supplier":"customer")&&(partner === "零售客户" || c.name.includes(partner))).slice(0,10).map(c=><Button key={c.id} title={`选择 ${c.name}`} kind="secondary" disabled={busy} onPress={()=>{setPartner(c.name);setPartnerId(c.id ?? null);}}/>)}
      <Button
        title="扫码添加商品"
        icon={Camera}
        onPress={scan}
        busy={scanning}
        disabled={busy}
      />
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="搜索要添加的商品或条码"
      />
      {!!query.trim() && (
        <Card>
          {matches.length ? (
            matches.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                onPress={() => {
                  if (!busy) add(product);
                }}
              />
            ))
          ) : (
            <Text style={s.caption}>未找到商品，请先在商品管理中建档。</Text>
          )}
        </Card>
      )}
      <Button title={includeInactive ? "隐藏下架商品" : "包含下架商品（清库存等）"} kind="secondary" disabled={busy} onPress={() => setIncludeInactive(!includeInactive)} />
      {!lines.length && (
        <Card>
          <Text style={s.caption}>扫码或搜索，添加第一件商品。</Text>
        </Card>
      )}
      {lines.map((line) => (
        <Card key={line.product.id}>
          <View style={s.between}>
            <View style={s.grow}>
              <Text style={s.rowTitle}>{line.product.name}{line.product.active === 0 ? "（已下架）" : ""}</Text>
              <Text style={s.caption}>
                可用库存 {line.product.stock} {line.product.unit}
              </Text>
            </View>
            <IconButton
              icon={Trash2}
              disabled={busy || scanning}
              label={`移除${line.product.name}`}
              onPress={() => {
                if (!busy)
                  setLines((current) =>
                    current.filter((item) => item !== line),
                  );
              }}
            />
          </View>
          <Columns>
            <Field
              label="数量"
              accessibilityLabel={`${line.product.name} 数量`}
              value={line.quantity}
              onChangeText={(value) =>
                update(line.product.id, "quantity", value)
              }
              keyboardType="number-pad"
              editable={!busy}
            />
            <Field
              label="单价"
              accessibilityLabel={`${line.product.name} 单价`}
              value={line.price}
              onChangeText={(value) => update(line.product.id, "price", value)}
              keyboardType="decimal-pad"
              editable={!busy}
            />
          </Columns>
          <View style={s.between}>
            <View style={s.row}>
              <IconButton
                icon={Minus}
                disabled={busy || scanning}
                label={`减少${line.product.name}数量`}
                onPress={() => {
                  if (!busy)
                    update(
                      line.product.id,
                      "quantity",
                      String(Math.max(1, (Number(line.quantity) || 1) - 1)),
                    );
                }}
              />
              <IconButton
                icon={Plus}
                disabled={busy || scanning}
                label={`增加${line.product.name}数量`}
                onPress={() => {
                  if (!busy)
                    update(
                      line.product.id,
                      "quantity",
                      String((Number(line.quantity) || 0) + 1),
                    );
                }}
              />
            </View>
            <Text style={s.rowTitle}>{money(orderTotal([line]))}</Text>
          </View>
        </Card>
      ))}
      <Field
        label="备注（选填）"
        value={note}
        onChangeText={setNote}
        maxLength={500}
        multiline
        editable={!busy}
      />
    </ScreenModal>
  );
}

export function SettingsEditor({
  settings,
  server,
  warehouses = [],
  onRefresh,
  onClose,
  onSaved,
}: {
  settings: Settings;
  warehouses?: Warehouse[];
  onRefresh?: () => Promise<void>;
  server?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [newWarehouse, setNewWarehouse] = useState("");
  const [editingWarehouse, setEditingWarehouse] = useState<{id:number;name:string}|null>(null);
  const saveWarehouse = async (id: number | null, name: string) => {
    if (!lock.enter()) return;
    setBusy(true); setError("");
    try {
      await api(id ? `/warehouses/${id}` : "/warehouses", id ? "PUT" : "POST", { name });
      setNewWarehouse(""); setEditingWarehouse(null);
      await onRefresh?.();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); lock.leave(); }
  };
  const [business, setBusiness] = useState(settings.business_name);
  const [warehouse, setWarehouse] = useState(settings.warehouse_name);
  const [units, setUnits] = useState(settings.units || ["件"]);
  const [imagebedBusy, setImagebedBusy] = useState(false);
  const [imagebedDirty, setImagebedDirty] = useState(false);
  useEffect(() => setWarehouse(settings.warehouse_name), [settings.warehouse_name]);
  const { error, errorRevision, setError } = useFormError();
  const [busy, setBusy] = useState(false);
  const lock = useSubmitLock();
  const reset = async () => {
    if (!lock.enter()) return;
    setBusy(true);
    setError("");
    try {
      await api("/settings/reset", "POST", { confirmation: "RESET_BUSINESS_DATA" });
      onSaved("业务数据已清空，账户和配置已保留");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.leave();
    }
  };
  const confirmReset = () => Alert.alert(
    "确定重置业务数据？",
    "所有商品、库存、入出库单据、往来单位、模板及收付款/盘点记录（包括正式数据）将永久删除，无法恢复。管理员账户、登录信息、服务器地址及已保存的商户和仓库名称会保留。",
    [
      { text: "取消", style: "cancel" },
      { text: "确认清空", style: "destructive", onPress: reset },
    ],
  );
  const save = async () => {
    if (!lock.enter()) return;
    setBusy(true);
    setError("");
    try {
      if (!business.trim() || !warehouse.trim())
        throw new Error("商户和仓库名称不能为空。");
      await api("/settings", "PUT", {
        business_name: business.trim(),
        warehouse_name: warehouse.trim(),
        units,
      });
      onSaved("工作空间设置已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.leave();
    }
  };
  return (
    <ScreenModal
      title="工作空间设置"
      onClose={onClose}
      error={error}
      errorRevision={errorRevision}
      dirty={
        business !== settings.business_name ||
        warehouse !== settings.warehouse_name ||
        JSON.stringify(units) !== JSON.stringify(settings.units || ["件"]) || imagebedDirty
      }
      busy={busy || imagebedBusy}
      footer={<Button title="保存设置" onPress={save} busy={busy} disabled={imagebedBusy || imagebedDirty} />}
    >
      <UpdateCard />
      <ImagebedSettings onBusy={setImagebedBusy} onDirty={setImagebedDirty} />
      <Card>
        <Field
          label="商户名称"
          value={business}
          onChangeText={setBusiness}
          maxLength={60}
          editable={!busy}
        />
        <Field
          label="仓库名称"
          value={warehouse}
          onChangeText={setWarehouse}
          maxLength={60}
          editable={!busy}
        />
      </Card>
      <Card>
        <Text style={s.subtitle}>计量单位</Text>
        <Text style={s.caption}>各仓库共用，第一项作为新增商品的默认单位。修改列表不会改变已有商品的单位，点击「保存设置」后生效。</Text>
        {units.map((unit, index) => (
          <View key={index} style={s.row}>
            <View style={s.grow}>
              <Field label={`单位 ${index + 1}${index === 0 ? "（默认）" : ""}`} value={unit} maxLength={100} editable={!busy} onChangeText={value => setUnits(current => current.map((item, i) => i === index ? value : item))} />
            </View>
            <IconButton icon={Trash2} label={`删除单位 ${index + 1}`} disabled={busy || units.length === 1} onPress={() => setUnits(current => current.filter((_, i) => i !== index))} />
          </View>
        ))}
        <Button title="新增单位" icon={Plus} kind="secondary" disabled={busy || units.length >= 100} onPress={() => setUnits(current => [...current, ""])} />
      </Card>
      <Card>
        <Text style={s.subtitle}>仓库管理</Text>
        <Text style={s.caption}>在顶部点击仓库名称切换。各仓库库存、单据和模板独立。</Text>
        <Field label="新仓库名称" value={newWarehouse} onChangeText={setNewWarehouse} maxLength={60} editable={!busy} />
        <Button title="新增仓库" kind="secondary" disabled={busy || !newWarehouse.trim()} onPress={() => void saveWarehouse(null, newWarehouse)} />
        {warehouses.map(w => <View key={w.id}>
          {editingWarehouse?.id === w.id ? <>
            <Field label={`修改${w.name}名称`} value={editingWarehouse.name} maxLength={60} editable={!busy} onChangeText={name => setEditingWarehouse({ id: w.id, name })} />
            <Button title="保存仓库名称" disabled={busy} onPress={() => void saveWarehouse(w.id, editingWarehouse.name)} />
          </> : <View style={s.row}><Text style={[s.label, s.grow]}>{w.name}</Text><Button title="改名" kind="secondary" disabled={busy} onPress={() => setEditingWarehouse({ id: w.id, name: w.name })} /></View>}
        </View>)}
      </Card>
      <Card>
        {server && <>
          <Text style={s.caption}>Excel / CSV 导入和备份恢复在网页设置中操作，浏览器需单独登录。</Text>
          <Button title="打开网页数据管理" kind="secondary" disabled={busy} onPress={() => void Linking.openURL(`${server}/?manage=data&warehouse_id=${getWarehouseId()}`).catch(() => setError("无法打开浏览器，请手动访问服务器网页。"))} />
        </>}
        <Text style={s.subtitle}>重置业务数据</Text>
        <Text style={s.caption}>永久清空所有商品、库存、单据、往来单位、模板及收付款/盘点记录，包括正式数据。保留账户、登录信息、服务器地址及已保存的商户和仓库名称。</Text>
        <Button title="重置业务数据" kind="danger" icon={Trash2} onPress={confirmReset} disabled={busy} />
      </Card>
    </ScreenModal>
  );
}
