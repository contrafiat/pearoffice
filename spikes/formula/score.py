# What Excel returns for the corpus (365, 1900 date system).
import json,sys
X={'C1':-0.85,'C2':0.3,'C3':-0.141666666666667,'C4':-22.48,'C5':1e42,'C6':1/3,'C7':1.4142135623731,'C8':2.71828182845905,'C9':2.30258509299405,'C10':0.841470984807897,'C11':17.4494022688864,'C12':1.10714871779409,'C13':3.663388686266674,'C14':-0.899,'C15':2,'C16':'#DIV/0!','C17':'apple Banana','C18':'BANANA','C19':5,'C20':'no','C21':2,'C22':10.35,'C23':3,'C24':6.4,'C25':2024,'C26':2,'C27':29,'C28':2,'C29':45382,'C30':45351,'C31':59,'C32':'2024-01-01','C33':45361,'C34':9,'C35':536.821623012139,'C36':1227.88554916159,'C37':4.89105935386927,'C38':-1.7,'C39':-2.55,'C40':'#CIRC','D1':'#CIRC','C41':-0.141666666666667,'C42':True,'C43':True,'C44':3.141592,'C45':False,'C46':1,'C47':15,'C48':-21.975,'C49':0.00422066754538}
d=json.load(open(sys.argv[1]))
for eng in ['fast','hot','combo']:
    r=d[eng]['results']; bad=[]
    for k,x in X.items():
        v=r[k]
        if isinstance(x,str) and x.startswith('#'):
            ok=isinstance(v,dict) and 'error' in v and (x=='#CIRC' or x in v['error'])
        elif isinstance(x,bool): ok=v is x
        elif isinstance(x,(int,float)): ok=isinstance(v,(int,float)) and not isinstance(v,bool) and abs(v-x)<=1e-9*max(1,abs(x))
        else: ok=v==x
        if not ok: bad.append((k,v))
    print(eng, f'{len(X)-len(bad)}/{len(X)} match Excel; misses:', bad)
