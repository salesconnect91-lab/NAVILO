/** Running salary account: credit net is due to driver; debit net is due from driver. The legacy numeric advance property remains solely for existing API compatibility; a cash advance is not implied. */
export function driverSalaryPosition(payableBalance:number){
 const rounded=Math.round((payableBalance+Number.EPSILON)*100)/100;
 return {payable:Math.max(rounded,0),advance:Math.max(-rounded,0),label:rounded>0?'Due to Driver':rounded<0?'Due from Driver':'Settled'};
}
