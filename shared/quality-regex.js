import { RE2JS } from 're2js';

const compiled = new Map();
export function regexRule(config) {
  const pattern=config.regexPattern??'', replacement=config.regexReplacement??'';
  if(typeof pattern!=='string'||pattern.length>1000)throw new Error('正则表达式最多 1000 个字符。');
  if(typeof replacement!=='string'||replacement.length>2000)throw new Error('正则替换内容最多 2000 个字符。');
  if(!pattern){if(replacement)throw new Error('请填写正则表达式，或清空替换内容。');return null;}
  if(!['string','number'].includes(config.type))throw new Error('正则替换仅支持字符串和数字类型。');
  let regex=compiled.get(pattern);
  if(!regex){
    try{regex=RE2JS.compile(pattern);}catch{throw new Error('正则表达式无效或包含不支持的语法；不支持前后查找和表达式内的反向引用。');}
    if(compiled.size>=100)compiled.delete(compiled.keys().next().value);
    compiled.set(pattern,regex);
  }
  return {pattern,replacement,regex};
}

export function replaceRegexText(text,config) {
  const rule=regexRule(config);
  if(!rule)return text;
  if(text.length>10000)throw new Error('正则替换的原文不能超过 10000 个字符。');
  // Bound expansion as well as matching time; don't build an unbounded replaceAll result.
  const matcher=rule.regex.matcher(text);
  let result='';
  while(matcher.find()){
    result+=matcher.appendReplacement(rule.replacement);
    if(result.length>10000)throw new Error('正则替换后的内容不能超过 10000 个字符。');
  }
  result+=matcher.appendTail();
  if(result.length>10000)throw new Error('正则替换后的内容不能超过 10000 个字符。');
  return result;
}
