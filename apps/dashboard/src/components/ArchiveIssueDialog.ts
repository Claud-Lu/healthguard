import { defineComponent, h, nextTick, ref, watch, type PropType } from 'vue';
import { apiUrl, requestJson } from '../api';
import { store, type IssueSummary } from '../globalStore';

export default defineComponent({
 props: { issue: { type: Object as PropType<IssueSummary | null>, default: null } },
 emits: ['cancel', 'archived'],
 setup(props, { emit }) {
  const dialog=ref<HTMLDialogElement|null>(null), input=ref<HTMLTextAreaElement|null>(null);
  const note=ref(''), saving=ref(false), error=ref('');
  const text=()=>store.locale==='zh-CN'
   ? {title:'是否确认归档？',hint:'归档仅收起此问题，不代表已修复。后续上报仍会计数，保持已归档；需要时可手动恢复。',note:'归档备注（选填）',placeholder:'例如：服务端已修复、重复问题或其他归档原因',cancel:'取消',confirm:'确认归档',saving:'归档中…',failed:'归档失败，请重试。',long:'备注最多 4000 个字符。'}
   : {title:'Archive this issue?',hint:'Archiving does not mark the issue as fixed. New reports remain counted while the issue stays archived. You can restore it manually.',note:'Archive note (optional)',placeholder:'Server-side fix, duplicate issue, or another reason',cancel:'Cancel',confirm:'Confirm archive',saving:'Archiving…',failed:'Archive failed. Please retry.',long:'The note must be at most 4000 characters.'};
  watch(()=>props.issue,async issue=>{
   if(!issue){dialog.value?.close();return;}
   note.value='';error.value='';
   await nextTick();if(props.issue?.id!==issue.id)return;
   dialog.value?.showModal();input.value?.focus();
  });
  function cancel(){if(saving.value)return;dialog.value?.close();emit('cancel');}
  async function submit(event:Event){
   event.preventDefault();if(saving.value||!props.issue)return;
   const issue=props.issue, value=note.value.trim();
   if(value.length>4000){error.value=text().long;return;}
   saving.value=true;error.value='';
   try{
    const response=await requestJson<{issue:IssueSummary}>(apiUrl(`/issues/${encodeURIComponent(issue.id)}/archive`),{method:'PATCH',body:JSON.stringify({note:value})},store.token);
    if(props.issue?.id!==issue.id)return;
    dialog.value?.close();emit('archived',response.issue);
   }catch{error.value=text().failed;}
   finally{saving.value=false;}
  }
  return()=>{const t=text();return h('dialog',{ref:dialog,class:'archive-dialog','aria-labelledby':'archive-dialog-title','aria-describedby':'archive-dialog-hint',onCancel:(event:Event)=>{event.preventDefault();cancel();},onClick:(event:MouseEvent)=>{if(event.target===dialog.value){const r=dialog.value!.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)cancel();}}},[
   h('form',{class:'archive-form',onSubmit:submit},[
    h('h2',{id:'archive-dialog-title'},t.title),h('p',{id:'archive-dialog-hint'},t.hint),
    h('label',{class:'field'},[h('span',t.note),h('textarea',{ref:input,value:note.value,rows:4,maxlength:4000,placeholder:t.placeholder,disabled:saving.value,'aria-invalid':!!error.value,onInput:(event:Event)=>{note.value=(event.target as HTMLTextAreaElement).value;error.value='';}})]),
    error.value?h('p',{class:'error',role:'alert'},error.value):null,
    h('div',{class:'modal-actions'},[h('button',{type:'button',class:'outline-button',disabled:saving.value,onClick:cancel},t.cancel),h('button',{type:'submit',class:'archive-confirm-button',disabled:saving.value},saving.value?t.saving:t.confirm)])
   ])
  ]);};
 }
});
