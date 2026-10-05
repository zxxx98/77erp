import React, { useRef, useState } from "react";
import { Alert, Image, Linking, Text, View } from "react-native";
import { Camera, Check, Minus, Plus, Trash2 } from "lucide-react-native";
import { api, device, scanBarcode } from "./native";
import {
  Category,
  flattenCategories,
  addLine,
  Contact,
  Draft,
  Line,
  matchesProduct,
  money,
  orderPayload,
  orderTotal,
  Product,
  ProductForm,
  productPayload,
  Settings,
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
  onClose,
  onSaved,
}: {
  product?: Product;
  categories?: Category[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const options = flattenCategories(categories);
  const selected = options.find(c => c.id === product?.category_id) || options[0];
  const initial: ProductForm = {
    name: product?.name ?? "",
    barcode: product?.barcode ?? "",
    category: product?.category ?? selected?.path ?? "",
    category_id: String(product?.category_id ?? selected?.id ?? ""),
    image: product?.image ?? "",
    specification: product?.specification ?? "",
    note: product?.note ?? "",
    unit: product?.unit ?? "件",
    cost: String(product?.cost ?? 0),
    price: String(product?.price ?? 0),
    threshold: String(product?.threshold ?? 5),
  };
  const [form, setForm] = useState(initial);
  const { error, errorRevision, setError } = useFormError();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const lock = useSubmitLock();
  const field = (key: keyof ProductForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!lock.enter()) return;
    setBusy(true);
    setError("");
    try {
      const payload = productPayload(form);
      await api(
        product ? `/products/${product.id}` : "/products",
        product ? "PUT" : "POST",
        payload,
      );
      onSaved(product ? "商品已更新" : "商品已创建，初始库存为 0");
    } catch (e) {
      setError((e as Error).message);
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
      if (code) field("barcode")(code);
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
      dirty={JSON.stringify(form) !== JSON.stringify(initial)}
      busy={busy || scanning || pickingImage}
      footer={
        <Button
          title="保存商品"
          icon={Check}
          busy={busy}
          disabled={scanning || pickingImage}
          onPress={save}
        />
      }
    >
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
      </Card>
      <Card>
        <Text style={s.label}>商品图片</Text>
        {!!form.image && <Image source={{ uri: form.image }} accessibilityLabel="商品图片预览" style={{ width: '100%', height: 180, borderRadius: 8 }} resizeMode="contain" />}
        <Button title="选择商品图片" kind="secondary" busy={pickingImage} disabled={busy || scanning} onPress={async () => {
          setPickingImage(true); setError('');
          try { const image = await device.pickImage(); if (image) field('image')(image); }
          catch (e) { setError((e as Error).message); }
          finally { setPickingImage(false); }
        }} />
        {!!form.image && <Button title="移除图片" kind="secondary" disabled={busy || pickingImage} onPress={() => field('image')('')} />}
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
    </ScreenModal>
  );
}

export function OrderEditor({
  type,
  products,
  initialProduct,
  initialDraft,
  contacts = [],
  onClose,
  onSaved,
}: {
  type: "in" | "out";
  products: Product[];
  initialProduct?: Product;
  initialDraft?: Draft;
  contacts?: Contact[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [partner, setPartner] = useState(initialDraft?.partner ?? (type === "out" ? "零售客户" : ""));
  const [partnerId, setPartnerId] = useState<number|null>(initialDraft?.partner_id ?? null);
  const [note, setNote] = useState(initialDraft?.note || "");
  const draftRequest = useRef({key:"",id:""});
  const missingDraftProduct = initialDraft?.items.some(i => !products.some(p => p.id === i.product_id));
  const [lines, setLines] = useState<Line[]>(() =>
    initialDraft ? initialDraft.items.flatMap(i => { const product=products.find(p=>p.id===i.product_id);return product ? [{product,quantity:String(i.quantity),price:String(i.price)}] : []; }) : initialProduct ? addLine([], initialProduct, type) : [],
  );
  const [query, setQuery] = useState("");
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
        const product = products.find((item) => item.barcode === code.trim());
        if (!product)
          throw new Error(`未找到条码「${code}」，请先建立商品档案。`);
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
      if (missingDraftProduct) throw new Error("草稿商品已变化，请刷新后重新打开。");
      const payload = {...orderPayload(type, partner, note, lines), ...(partnerId ? {partner_id:partnerId} : {}), ...(initialDraft ? {draft_id:initialDraft.id,draft_version:initialDraft.version} : {})};
      const result = await api<{ number: string }>("/orders", "POST", payload);
      // Close immediately after the mutation succeeds; a refresh error must not allow resubmission.
      onSaved(`单据 ${result.number} 已保存`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.leave();
    }
  };
  const saveDraft = async () => {
    if (!lock.enter()) return;
    setBusy(true);setError("");
    try {
      if (missingDraftProduct) throw new Error("草稿商品已变化，请刷新后重新打开。");
      const body={...(initialDraft ? {id:initialDraft.id,version:initialDraft.version}:{}),type,partner,partner_id:partnerId,note,items:lines.map(i=>({product_id:i.product.id,quantity:i.quantity,price:i.price}))};
      const key=JSON.stringify(body);if(draftRequest.current.key!==key)draftRequest.current={key,id:`${Date.now()}-${Math.random().toString(36).slice(2)}`};
      await api("/drafts","POST",{...body,request_id:draftRequest.current.id});onSaved("草稿已保存，库存未变化");
    } catch(e) { setError((e as Error).message); } finally { setBusy(false);lock.leave(); }
  };
  const confirm = () => {
    try {
      if (missingDraftProduct) throw new Error("草稿商品已变化，请刷新后重新打开。");
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
    ? products.filter((product) => matchesProduct(product, query)).slice(0, 20)
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
      {initialDraft && <Text style={s.caption}>正在编辑草稿 #{initialDraft.id} · 版本 {initialDraft.version}</Text>}
      <Button title="保存草稿并关闭" kind="secondary" disabled={busy || scanning} onPress={() => void saveDraft()} />
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
      {!lines.length && (
        <Card>
          <Text style={s.caption}>扫码或搜索，添加第一件商品。</Text>
        </Card>
      )}
      {lines.map((line) => (
        <Card key={line.product.id}>
          <View style={s.between}>
            <View style={s.grow}>
              <Text style={s.rowTitle}>{line.product.name}</Text>
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
  onClose,
  onSaved,
}: {
  settings: Settings;
  server?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [business, setBusiness] = useState(settings.business_name);
  const [warehouse, setWarehouse] = useState(settings.warehouse_name);
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
    "所有商品、库存、入出库单据、往来单位、草稿及收付款/盘点记录（包括正式数据）将永久删除，无法恢复。管理员账户、登录信息、服务器地址及已保存的商户和仓库名称会保留。",
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
        warehouse !== settings.warehouse_name
      }
      busy={busy}
      footer={<Button title="保存设置" onPress={save} busy={busy} />}
    >
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
        {server && <>
          <Text style={s.caption}>Excel / CSV 导入和备份恢复在网页设置中操作，浏览器需单独登录。</Text>
          <Button title="打开网页数据管理" kind="secondary" disabled={busy} onPress={() => void Linking.openURL(`${server}/?manage=data`).catch(() => setError("无法打开浏览器，请手动访问服务器网页。"))} />
        </>}
        <Text style={s.subtitle}>重置业务数据</Text>
        <Text style={s.caption}>永久清空所有商品、库存、单据、往来单位、草稿及收付款/盘点记录，包括正式数据。保留账户、登录信息、服务器地址及已保存的商户和仓库名称。</Text>
        <Button title="重置业务数据" kind="danger" icon={Trash2} onPress={confirmReset} disabled={busy} />
      </Card>
    </ScreenModal>
  );
}
