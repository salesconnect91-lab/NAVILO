/** Positive is payable to the driver; negative is salary paid in advance. */
export function driverSalaryPosition(payableBalance:number){
 const rounded=Math.round((payableBalance+Number.EPSILON)*100)/100;
 return {payable:Math.max(rounded,0),advance:Math.max(-rounded,0),label:rounded>0?'Salary payable':rounded<0?'Salary advance':'Settled'};
}
