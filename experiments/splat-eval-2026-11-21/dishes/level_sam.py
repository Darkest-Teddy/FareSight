"""Estimate serving-plane normal around the visible rim, then recheck the two side profiles."""
import math
import numpy as np
from evaluate import vertices
from sam_pose import propose

def rotation(level):
    a,b,c=np.radians(level);ca,sa,cb,sb,cc,sc=np.cos(a),np.sin(a),np.cos(b),np.sin(b),np.cos(c),np.sin(c)
    return np.array([[cc,-sc,0],[sc,cc,0],[0,0,1]])@np.array([[cb,0,sb],[0,1,0],[-sb,0,cb]])@np.array([[1,0,0],[0,ca,-sa],[0,sa,ca]])

def angles(normal):
    nx,ny,nz=normal
    return (round(math.degrees(math.atan2(-nz,ny)),2),0,round(math.degrees(math.atan2(nx,math.hypot(ny,nz))),2))

def level(folder,r,method='rim'):
    if method.startswith('xyz:'):
        x,y,z=map(float,method.removeprefix('xyz:').split(','))
        return (x,y,z)
    base=propose(r)
    if method=='metadata':return base
    _,v=vertices(folder/'raw.ply')
    p=np.column_stack([-v['x'],-v['y'],v['z']])
    if len(p)>120000:p=p[::math.ceil(len(p)/120000)]
    rot=rotation(base);p=p@rot.T
    p-=np.median(p,axis=0)
    if method=='flat':
        n=np.linalg.eigh(np.cov(p.T))[1][:,0]
        if n[1]<0:n=-n
    else:
        theta=np.arctan2(p[:,2],p[:,0]);rad=np.hypot(p[:,0],p[:,2])
        edge=[]
        for a,b in zip(np.linspace(-np.pi,np.pi,25)[:-1],np.linspace(-np.pi,np.pi,25)[1:]):
            sec=(theta>=a)&(theta<b)
            if sec.sum()>10:edge.append(np.median(p[sec&(rad>=np.quantile(rad[sec],.98))],axis=0))
        edge=np.array(edge)
        design=np.column_stack([edge[:,0],edge[:,2],np.ones(len(edge))])
        sx,sz,_=np.linalg.lstsq(design,edge[:,1],rcond=None)[0]
        n=np.array([-sx,1,-sz]);n/=np.linalg.norm(n)
    return angles(rot.T@n)
