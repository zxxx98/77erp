import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Camera, Check, Minus, Plus, Trash2 } from "lucide-react-native";
import { api, scanBarcode } from "./native";
import {
  addLine,
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
  onClose,
  onSaved,
}: {
  product?: Product;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const initial: ProductForm = {
    name: product?.name ?? "",
    barcode: product?.barcode ?? "",
    category: product?.category ?? "日用百货",
    unit: product?.unit ?? "件",
    cost: String(product?.cost ?? 0),
    price: String(product?.price ?? 0),
    threshold: String(product?.threshold ?? 5),
  };
  const [form, setForm] = useState(initial);
  const { error, errorRevision, setError } = useFormError();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
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
      busy={busy || scanning}
      footer={
        <Button
          title="保存商品"
          icon={Check}
          busy={busy}
          disabled={scanning}
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
          placeholder="例如：极简陶瓷马克杯"
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
          disabled={busy}
        />
        <Text style={s.caption}>
          {product
            ? "编辑时留空将保留原条码。"
            : "商品库存从 0 开始，通过采购入库增加库存。"}
        </Text>
        <Columns>
          <Field
            label="分类"
            value={form.category}
            onChangeText={field("category")}
            maxLength={100}
            editable={!busy}
          />
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
  onClose,
  onSaved,
}: {
  type: "in" | "out";
  products: Product[];
  initialProduct?: Product;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [partner, setPartner] = useState(type === "out" ? "零售客户" : "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    initialProduct ? addLine([], initialProduct, type) : [],
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
      const payload = orderPayload(type, partner, note, lines);
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
  const confirm = () => {
    try {
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
      <Field
        label={type === "in" ? "供应商" : "客户"}
        value={partner}
        onChangeText={setPartner}
        maxLength={100}
        editable={!busy}
      />
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
  onClose,
  onSaved,
}: {
  settings: Settings;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [business, setBusiness] = useState(settings.business_name);
  const [warehouse, setWarehouse] = useState(settings.warehouse_name);
  const { error, errorRevision, setError } = useFormError();
  const [busy, setBusy] = useState(false);
  const lock = useSubmitLock();
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
    </ScreenModal>
  );
}
