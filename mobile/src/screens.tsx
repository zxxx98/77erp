import React, { useEffect, useState } from "react";
import { FlatList, Image, Linking, StyleSheet, Text, View } from "react-native";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  Camera,
  Check,
  Eye,
  EyeOff,
  LogOut,
  Plus,
  ScanLine,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Warehouse,
} from "lucide-react-native";
import { PaymentEditor } from "./commerce";
import { OrderCorrection } from "./operations";
import { api, ApiError, scanBarcode } from "./native";
import {
  Category,
  flattenCategories,
  categoryBranch,
  AuthState,
  dateTime,
  matchesProduct,
  money,
  Order,
  orderLabel,
  businessType,
  reportOrders,
  Product,
  Workspace,
} from "./model";
import {
  Button,
  Card,
  Chips,
  Columns,
  colors,
  DetailRow,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  ProductRow,
  ScreenModal,
  SearchField,
  s,
  StockBadge,
  useFormError,
  useSubmitLock,
} from "./ui";

export function ServerScreen({
  initial,
  busy,
  error,
  onConnect,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  error: string;
  onConnect: (address: string) => void;
  onCancel?: () => void;
}) {
  const [address, setAddress] = useState(initial);
  return (
    <>
      <View style={styles.brand}>
        <View style={styles.brandMark}>
          <Text allowFontScaling={false} style={styles.brandNumber}>
            77
          </Text>
        </View>
        <View style={s.grow}>
          <Text style={s.title}>77 ERP</Text>
          <Text style={s.caption}>轻量进销存</Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={s.title}>连接工作空间</Text>
        <Text style={s.caption}>
          填写服务器地址，连接你的商品、库存和单据。
        </Text>
      </View>
      <Card>
        <Field
          label="服务器地址"
          value={address}
          onChangeText={setAddress}
          placeholder="https://erp.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!busy}
        />
        <Text style={s.caption}>
          填写域名或 IP 和端口，无需加 /api。公网服务建议使用 HTTPS。
        </Text>
        <ErrorNotice message={error} />
        <Button
          title="连接服务器"
          icon={Server}
          onPress={() => onConnect(address)}
          busy={busy}
        />
        {onCancel && (
          <Button
            title="返回工作空间"
            kind="secondary"
            onPress={onCancel}
            disabled={busy}
          />
        )}
      </Card>
    </>
  );
}

export function AuthScreen({
  auth,
  server,
  notice,
  onSuccess,
  onRefresh,
  onServer,
}: {
  auth: AuthState;
  server: string;
  notice: string;
  onSuccess: (auth: AuthState) => void;
  onRefresh: () => void;
  onServer: () => void;
}) {
  const setup = !auth.initialized;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useSubmitLock();
  const submit = async () => {
    if (!lock.enter()) return;
    setBusy(true);
    setError("");
    try {
      if (!username.trim() || !password)
        throw new Error("请填写管理员账号和密码。");
      if (setup && !/^[A-Za-z0-9_.-]{3,32}$/.test(username.trim()))
        throw new Error("账号需为 3–32 位字母、数字或 ._-。");
      if (setup && password.length < 8)
        throw new Error("密码至少需要 8 位字符。");
      if (setup && password !== confirmation)
        throw new Error("两次输入的密码不一致。");
      const next = await api<AuthState>(
        setup ? "/auth/setup" : "/auth/login",
        "POST",
        { username: username.trim(), password },
      );
      setPassword("");
      setConfirmation("");
      onSuccess(next);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) onRefresh();
    } finally {
      setBusy(false);
      lock.leave();
    }
  };
  return (
    <>
      <View style={styles.brand}>
        <View style={styles.brandMark}>
          <Text allowFontScaling={false} style={styles.brandNumber}>
            77
          </Text>
        </View>
        <Text style={s.title}>ERP</Text>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={s.title}>{setup ? "设置管理员" : "管理员登录"}</Text>
        <Text style={s.caption}>
          {setup
            ? "首次使用，请创建唯一的管理员账号。"
            : "登录后管理商品、库存与单据。"}
        </Text>
      </View>
      <Card>
        <Field
          label="管理员账号"
          value={username}
          onChangeText={setUsername}
          maxLength={32}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          editable={!busy}
        />
        <Field
          label="密码"
          value={password}
          onChangeText={setPassword}
          maxLength={128}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoComplete={setup ? "new-password" : "current-password"}
          editable={!busy}
          accessory={
            <IconButton
              icon={visible ? EyeOff : Eye}
              label={visible ? "隐藏密码" : "显示密码"}
              onPress={() => setVisible(!visible)}
              disabled={busy}
            />
          }
        />
        {setup && (
          <Field
            label="确认密码"
            value={confirmation}
            onChangeText={setConfirmation}
            maxLength={128}
            secureTextEntry
            autoComplete="new-password"
            editable={!busy}
          />
        )}
        <ErrorNotice message={error || notice} />
        <Button
          title={setup ? "创建管理员并进入" : "登录"}
          onPress={submit}
          busy={busy}
          icon={ShieldCheck}
        />
      </Card>
      <Text style={s.caption}>{server}</Text>
      <Button
        title="修改服务器地址"
        kind="secondary"
        icon={Server}
        onPress={onServer}
        disabled={busy}
      />
    </>
  );
}

export function Dashboard({
  data,
  openOrder,
  openScanner,
  openProduct,
  openHistory,
}: {
  data: Workspace;
  openOrder: (type: "in" | "out", product?: Product) => void;
  openScanner: () => void;
  openProduct: (product: Product) => void;
  openHistory: () => void;
}) {
  const today = reportOrders(data.orders).filter(
    (order) =>
      new Date(order.created_at).toDateString() === new Date().toDateString(),
  );
  const low = data.products.filter(
    (product) => product.stock <= product.threshold,
  );
  const stats = [
    { label: "商品种类", value: String(data.products.length), icon: Box },
    {
      label: "库存成本",
      value: money(
        data.products.reduce(
          (total, product) => total + (product.inventory_value_cents ?? Math.round(product.stock * product.cost * 100)) / 100,
          0,
        ),
      ),
      icon: Warehouse,
    },
    {
      label: "今日采购",
      value: money(
        today
          .filter((order) => order.type === "in")
          .reduce((total, order) => total + order.total, 0),
      ),
      icon: ArrowDownToLine,
    },
    {
      label: "今日销售",
      value: money(
        today
          .filter((order) => order.type === "out")
          .reduce((total, order) => total + order.total, 0),
      ),
      icon: ArrowUpFromLine,
    },
  ];
  return (
    <>
      <View>
        <Text style={s.title}>工作台</Text>
        <Text style={s.caption}>
          {data.settings.business_name} · {data.settings.warehouse_name}
        </Text>
      </View>
      <Columns minimum={145}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.stat}>
            <View style={s.between}>
              <Text style={s.caption}>{stat.label}</Text>
              <stat.icon size={18} color={colors.blue} />
            </View>
            <Text selectable style={styles.statValue}>
              {stat.value}
            </Text>
          </View>
        ))}
      </Columns>
      <Card>
        <Text style={s.subtitle}>快速操作</Text>
        <Button title="扫描商品条码" icon={ScanLine} onPress={openScanner} />
        <Columns>
          <Button
            title="采购入库"
            icon={ArrowDownToLine}
            kind="secondary"
            onPress={() => openOrder("in")}
          />
          <Button
            title="销售出库"
            icon={ArrowUpFromLine}
            kind="secondary"
            onPress={() => openOrder("out")}
          />
        </Columns>
      </Card>
      <Card>
        <View style={s.between}>
          <Text style={s.subtitle}>库存预警</Text>
          <Text style={{ color: colors.orange }}>{low.length} 件商品</Text>
        </View>
        {low.length ? (
          low
            .slice(0, 5)
            .map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                onPress={() => openProduct(product)}
              />
            ))
        ) : (
          <Text style={s.caption}>所有商品库存充足。</Text>
        )}
      </Card>
      <Card>
        <Text style={s.subtitle}>最近单据</Text>
        {data.orders.slice(0, 3).map((order) => (
          <OrderSummary key={order.id} order={order} />
        ))}
        {!data.orders.length && (
          <Text style={s.caption}>
            暂无单据，创建第一张入库单开始记录库存。
          </Text>
        )}
        <Button title="查看全部单据" kind="secondary" onPress={openHistory} />
      </Card>
    </>
  );
}

export function ProductsScreen({
  products,
  categories = [],
  manageCategories,
  inventory,
  refreshing,
  onRefresh,
  openProduct,
  addProduct,
  notice,
}: {
  products: Product[];
  categories?: Category[];
  manageCategories?: () => void;
  inventory: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  openProduct: (product: Product) => void;
  addProduct: () => void;
  notice?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部分类");
  const [stock, setStock] = useState("all");
  const options = flattenCategories(categories);
  const branch = categoryBranch(categories, Number(category));
  useEffect(() => {
    if (category !== "全部分类" && !categories.some(c => String(c.id) === category)) setCategory("全部分类");
  }, [categories, category]);
  const visible = products.filter(
    (product) =>
      matchesProduct(product, query) &&
      (category === "全部分类" || branch.has(product.category_id || 0)) &&
      (stock === "all" ||
        (stock === "empty"
          ? product.stock === 0
          : product.stock <= product.threshold)),
  );
  return (
    <FlatList
      data={visible}
      keyExtractor={(product) => String(product.id)}
      renderItem={({ item }) => (
        <ProductRow product={item} onPress={() => openProduct(item)} />
      )}
      refreshing={refreshing}
      onRefresh={onRefresh}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={[s.pageContent, { paddingBottom: 24 }]}
      ListHeaderComponent={
        <View style={s.content}>
          {notice}
          <View style={s.between}>
            <View style={s.grow}>
              <Text style={s.title}>{inventory ? "库存管理" : "商品管理"}</Text>
              <Text style={s.caption}>
                共 {products.length} 种商品 · 筛选 {visible.length} 种
              </Text>
            </View>
            {!inventory && (
              <IconButton label="新增商品" icon={Plus} onPress={addProduct} />
            )}
          </View>
          {!inventory && manageCategories && <Button title="管理分类" kind="secondary" onPress={manageCategories} />}
          <SearchField value={query} onChangeText={setQuery} />
          {inventory ? (
            <Chips
              value={stock}
              onChange={setStock}
              options={[
                { id: "all", label: "全部库存" },
                { id: "low", label: "库存预警" },
                { id: "empty", label: "缺货" },
              ]}
            />
          ) : (
            <Chips
              value={category}
              onChange={setCategory}
              options={[{id: "全部分类", label: "全部分类"}, ...options.map(c => ({id: String(c.id), label: c.path}))]}
            />
          )}
        </View>
      }
      ListEmptyComponent={
        <Empty title="未找到商品" detail="尝试调整筛选条件，或新增商品档案。" />
      }
    />
  );
}

export function ProductDetail({
  product,
  onClose,
  edit,
  openOrder,
}: {
  product: Product;
  onClose: () => void;
  edit: () => void;
  openOrder: (type: "in" | "out", product: Product) => void;
}) {
  return (
    <ScreenModal
      title="商品详情"
      onClose={onClose}
      footer={
        <Columns>
          <Button
            title="采购入库"
            kind="secondary"
            onPress={() => openOrder("in", product)}
          />
          <Button
            title="销售出库"
            disabled={!product.stock}
            onPress={() => openOrder("out", product)}
          />
        </Columns>
      }
    >
      <Card>
        <View style={s.row}>
          <View style={s.productIcon}>
            {product.image ? <Image source={{ uri: product.image }} style={{ width: 48, height: 48, borderRadius: 8 }} accessibilityLabel={product.name} /> : <Box color={colors.blue} size={27} />}
          </View>
          <View style={s.grow}>
            <Text style={s.subtitle}>{product.name}</Text>
            <Text selectable style={s.caption}>
              {product.barcode}
            </Text>
          </View>
        </View>
        {!!product.image && <Image source={{ uri: product.image }} resizeMode="contain" style={{ width: "100%", height: 200 }} accessibilityLabel="商品图片" />}
        <StockBadge product={product} />
        <View style={s.divider} />
        <DetailRow
          label="当前库存"
          value={`${product.stock} ${product.unit}`}
        />
        <DetailRow
          label="安全库存"
          value={`${product.threshold} ${product.unit}`}
        />
        <DetailRow label="分类" value={product.category} />
        <DetailRow label="规格" value={product.specification || "未填写"} />
        <DetailRow label="备注" value={product.note || "未填写"} />
      </Card>
      <Card>
        <DetailRow label="采购价" value={money(product.cost)} />
        <DetailRow label="销售价" value={money(product.price)} />
      </Card>
      <Button title="编辑商品" kind="secondary" onPress={edit} />
    </ScreenModal>
  );
}

function OrderSummary({ order }: { order: Order }) {
  return (
    <View style={{ gap: 10 }}>
      <View>
        <Text style={s.rowTitle}>
          {orderLabel(order)} · {order.partner}
        </Text>
        <Text style={s.caption}>{order.number}</Text>
        <Text style={s.caption}>{dateTime(order.created_at)}</Text>
      </View>
      <Text
        style={[
          s.rowTitle,
          { color: order.type === "in" ? colors.blue : colors.green },
        ]}
      >
        {money(order.total)}
      </Text>
    </View>
  );
}
export function OrdersScreen({
  orders,
  refreshing,
  onRefresh,
  onDetail,
  openOrder,
  notice,
}: {
  orders: Order[];
  refreshing: boolean;
  onRefresh: () => void;
  onDetail: (order: Order) => void;
  openOrder: (type: "in" | "out") => void;
  notice?: React.ReactNode;
}) {
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");
  const visible = orders.filter(
    (order) =>
      (type === "all" || businessType(order) === type) &&
      (period === "all" ||
        Date.now() - new Date(order.created_at).getTime() <=
          Number(period) * 86400000) &&
      `${order.number} ${order.partner} ${order.items.map((item) => item.name).join(" ")}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <FlatList
      data={visible}
      keyExtractor={(order) => String(order.id)}
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={[s.content, s.pageContent]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={
        <View style={{ gap: 14 }}>
          {notice}
          <Text style={s.title}>操作记录</Text>
          <Columns>
            <Button
              title="新建入库"
              icon={ArrowDownToLine}
              kind="secondary"
              onPress={() => openOrder("in")}
            />
            <Button
              title="新建出库"
              icon={ArrowUpFromLine}
              onPress={() => openOrder("out")}
            />
          </Columns>
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="搜索单据号、往来单位或商品"
          />
          <Chips
            value={type}
            onChange={setType}
            options={[
              { id: "all", label: "全部单据" },
              { id: "in", label: "采购入库" },
              { id: "out", label: "销售出库" },
            ]}
          />
          <Chips
            value={period}
            onChange={setPeriod}
            options={[
              { id: "all", label: "全部时间" },
              { id: "7", label: "近 7 天" },
              { id: "30", label: "近 30 天" },
            ]}
          />
          <Text style={s.caption}>
            共 {visible.length} 张单据 · 合计{" "}
            {money(visible.reduce((total, order) => total + order.total, 0))}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Card>
          <OrderSummary order={item} />
          <Button
            title={`查看单据 ${item.number}`}
            kind="secondary"
            onPress={() => onDetail(item)}
          />
        </Card>
      )}
      ListEmptyComponent={<Empty title="暂无单据" />}
    />
  );
}
export function OrderDetail({
  order,
  onClose,
  onSaved,
}: {
  order: Order;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return (
    <ScreenModal title="单据详情" onClose={onClose}>
      <Card>
        <Text style={s.subtitle}>
          {orderLabel(order)}
        </Text>
        <Text selectable style={s.body}>
          {order.number}
        </Text>
        <Text style={s.caption}>
          {order.partner} · {dateTime(order.created_at)}
        </Text>
        <Text style={s.title}>{money(order.total)}</Text>
      </Card>
      {order.items.map((item) => (
        <Card key={item.product_id}>
          <Text style={s.rowTitle}>{item.name}</Text>
          <Text selectable style={s.caption}>
            {item.barcode}
          </Text>
          <View style={s.between}>
            <Text style={s.body}>
              {item.quantity} × {money(item.price)}
            </Text>
            <Text style={s.rowTitle}>{money(item.quantity * item.price)}</Text>
          </View>
        </Card>
      ))}
      <PaymentEditor order={order} />
      <OrderCorrection order={order} onSaved={onSaved} />
      {!!order.note && (
        <Card>
          <Text style={s.label}>备注</Text>
          <Text style={s.body}>{order.note}</Text>
        </Card>
      )}
    </ScreenModal>
  );
}

export function ScannerScreen({
  products,
  onClose,
  openOrder,
}: {
  products: Product[];
  onClose: () => void;
  openOrder: (type: "in" | "out", product: Product) => void;
}) {
  const [mode, setMode] = useState<"query" | "in" | "out">("query");
  const [barcode, setBarcode] = useState("");
  const [selected, setSelected] = useState<Product>();
  const [busy, setBusy] = useState(false);
  const { error, errorRevision, setError } = useFormError();
  const lookup = (code: string) => {
    const product = products.find((item) => item.barcode === code.trim());
    if (!product) {
      setSelected(undefined);
      setError(`未找到条码「${code}」，请先建立商品档案。`);
      return;
    }
    setError("");
    setSelected(product);
    setBarcode("");
    if (mode !== "query") openOrder(mode, product);
  };
  const scan = async () => {
    setBusy(true);
    setError("");
    try {
      const code = await scanBarcode();
      if (code) lookup(code);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScreenModal
      title="扫码工作台"
      onClose={onClose}
      busy={busy}
      error={error}
      errorRevision={errorRevision}
    >
      <Chips
        value={mode}
        onChange={setMode}
        options={[
          { id: "query", label: "查找商品" },
          { id: "in", label: "扫码入库" },
          { id: "out", label: "扫码出库" },
        ]}
      />
      <Card>
        <View style={{ alignItems: "center", padding: 24, gap: 14 }}>
          <ScanLine size={64} color={colors.blue} />
          <Text style={s.subtitle}>扫描商品条码</Text>
          <Text style={s.caption}>扫码识别后，确认单据才会更新库存。</Text>
        </View>
        <Button
          title="打开摄像头扫码"
          icon={Camera}
          onPress={scan}
          busy={busy}
        />
        {error.includes("权限") && (
          <Button
            title="打开系统权限设置"
            kind="secondary"
            onPress={() => {
              void Linking.openSettings().catch(() =>
                setError("请手动打开系统设置管理摄像头权限。"),
              );
            }}
          />
        )}
      </Card>
      <Card>
        <Field
          label="手动输入条码"
          value={barcode}
          onChangeText={setBarcode}
          autoCapitalize="none"
          onSubmitEditing={() => {
            if (barcode.trim()) lookup(barcode);
          }}
        />
        <Button
          title="查询商品"
          kind="secondary"
          onPress={() => lookup(barcode)}
          disabled={!barcode.trim() || busy}
        />
      </Card>
      {selected && (
        <Card>
          <View style={s.row}>
            <Check color={colors.green} size={20} />
            <Text style={[s.subtitle, s.grow]}>商品已识别</Text>
          </View>
          <Text style={s.rowTitle}>{selected.name}</Text>
          <Text style={s.caption}>{selected.barcode}</Text>
          <StockBadge product={selected} />
          <Text style={s.body}>
            当前库存 {selected.stock} {selected.unit}
          </Text>
          <Columns>
            <Button
              title="采购入库"
              kind="secondary"
              onPress={() => openOrder("in", selected)}
            />
            <Button
              title="销售出库"
              onPress={() => openOrder("out", selected)}
              disabled={!selected.stock}
            />
          </Columns>
        </Card>
      )}
    </ScreenModal>
  );
}

export function MoreScreen({
  username,
  server,
  data,
  busy,
  settings,
  stocktake,
  commerce,
  changeServer,
  logout,
}: {
  username?: string;
  server: string;
  data: Workspace;
  busy: boolean;
  settings: () => void;
  stocktake: () => void;
  commerce: () => void;
  changeServer: () => void;
  logout: () => void;
}) {
  return (
    <>
      <Text style={s.title}>工作空间</Text>
      <Card>
        <View style={s.row}>
          <ShieldCheck size={30} color={colors.blue} />
          <View style={s.grow}>
            <Text style={s.subtitle}>{username || "管理员"}</Text>
            <Text style={s.caption}>管理员账号</Text>
          </View>
        </View>
      </Card>
      <Card>
        <Text style={s.subtitle}>{data.settings.business_name}</Text>
        <Text style={s.caption}>{data.settings.warehouse_name}</Text>
        <Button
          title="商户与仓库设置"
          kind="secondary"
          icon={SettingsIcon}
          onPress={settings}
        />
      </Card>
      <Button title="往来、草稿与财务" kind="secondary" onPress={commerce} />
      <Button title="库存盘点" kind="secondary" onPress={stocktake} />
      <Card>
        <Text style={s.label}>服务器地址</Text>
        <Text selectable style={s.caption}>
          {server}
        </Text>
        <Button
          title="切换服务器"
          kind="secondary"
          icon={Server}
          onPress={changeServer}
          disabled={busy}
        />
      </Card>
      <Button
        title="退出登录"
        kind="danger"
        icon={LogOut}
        onPress={logout}
        busy={busy}
      />
      <Text style={[s.caption, { textAlign: "center" }]}>
        77 ERP · 数据保存在服务器
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 24,
  },
  brandMark: {
    width: 54,
    height: 54,
    borderRadius: 15,
    backgroundColor: colors.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  brandNumber: {
    fontSize: 27,
    fontWeight: "800",
    color: colors.white,
    fontStyle: "italic",
  },
  stat: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  statValue: { fontSize: 23, fontWeight: "700", color: colors.text },
});
