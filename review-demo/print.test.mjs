import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pageSlices} from './dist/print.mjs';
test('covers all pixels once and avoids splitting text or charts',()=>{
 const slices=pageSlices(2300,1000,[{top:950,bottom:1020},{top:1800,bottom:2050}]);
 assert.deepEqual(slices,[{top:0,height:950},{top:950,height:850},{top:1800,height:500}]);
 assert.equal(slices.reduce((n,s)=>n+s.height,0),2300);
});
test('oversized elements cannot prevent pagination from making progress',()=>{
 assert.deepEqual(pageSlices(2100,1000,[{top:0,bottom:2100}]),[{top:0,height:1000},{top:1000,height:1000},{top:2000,height:100}]);
});
