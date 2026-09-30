const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
async function request(path, options={}) {
  const res = await fetch(`${API}${path}`, { credentials:'include', headers:{'Content-Type':'application/json',...(options.headers||{})}, ...options })
  const data = await res.json().catch(()=>({}))
  if (!res.ok) throw new Error(data.message || 'Request failed')
  return data
}
export const api = {
  login:credentials=>request('/auth/login',{method:'POST',body:JSON.stringify(credentials)}),
  session:()=>request('/auth/session'),
  logout:()=>request('/auth/logout',{method:'POST'}),
  health:()=>request('/health'), users:()=>request('/users'), groups:()=>request('/groups'),
  createGroup:b=>request('/groups',{method:'POST',body:JSON.stringify(b)}),
  dashboard:id=>request(`/groups/${id}/dashboard`), members:id=>request(`/groups/${id}/members`),
  removeMember:(groupId,userId)=>request(`/groups/${groupId}/members/${userId}`,{method:'DELETE'}),
  addMember:(id,b)=>request(`/groups/${id}/members`,{method:'POST',body:JSON.stringify(b)}),
  expenses:id=>request(`/groups/${id}/expenses`),
  addExpense:(id,b)=>request(`/groups/${id}/expenses`,{method:'POST',body:JSON.stringify(b)}),
  balances:id=>request(`/groups/${id}/balances`), settlements:id=>request(`/groups/${id}/settlements`),
  settle:(id,b)=>request(`/groups/${id}/settlements`,{method:'POST',body:JSON.stringify(b)})
}
