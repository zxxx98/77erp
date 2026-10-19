const money = (v) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);

const count = (v) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(v);

const shortDate = (v) =>
  new Date(v).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });

const dateTime = (v) =>
  new Date(v).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const todayKey = () => new Date().toLocaleDateString("en-CA");

const sameDay = (a, b) =>
  new Date(a).toDateString() === new Date(b).toDateString();

const stockStatus = (p) =>
  p.threshold <= 0 ? "不预警" : p.stock === 0 ? "缺货" : p.stock <= p.threshold ? "库存偏低" : "库存充足";

const stockTone = (p) =>
  p.threshold <= 0 ? "gray" : p.stock === 0 ? "red" : p.stock <= p.threshold ? "orange" : "green";

export { money, count, shortDate, dateTime, todayKey, sameDay, stockStatus, stockTone };
