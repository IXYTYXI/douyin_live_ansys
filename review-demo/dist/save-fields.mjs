export function noteFields(scope,draft={},fallback={}){
 const fields={conclusion:draft.conclusion??fallback.conclusion??'',adjustment:draft.adjustment??fallback.adjustment??''};
 if(scope==='range'){fields.periodTheme=draft.periodTheme??fallback.periodTheme??'';fields.keywords=draft.keywords??fallback.keywords??[];}
 return fields;
}
