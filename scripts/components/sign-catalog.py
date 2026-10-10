#!/usr/bin/env python3
"""Sign reviewed metadata locally with an external Ed25519 key; performs no publication."""
import argparse
import json
from pathlib import Path
from artifacts import canonical,envelope


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--catalog',type=Path,required=True)
 parser.add_argument('--signing-key',type=Path,required=True)
 parser.add_argument('--key-id',required=True)
 parser.add_argument('--output',type=Path,required=True)
 args=parser.parse_args()
 catalog=json.loads(args.catalog.read_bytes())
 if set(catalog)!={'schemaVersion','revision','issuedAt','expiresAt','rows','revoked'} or catalog['schemaVersion']!=1 or catalog['revision']<1:
  raise ValueError('Strict schema-1 release catalog required')
 if not 0<catalog['expiresAt']-catalog['issuedAt']<=31*24*3600:raise ValueError('Catalog lifetime limit')
 if len(catalog['rows'])>80 or len(catalog['revoked'])>2000:raise ValueError('Catalog row limit')
 for row in catalog['rows']:
  if row['availability']=='unavailable':
   if row['manifest'] is not None:raise ValueError('Unavailable row cannot advertise an artifact')
  elif row['availability']=='available':
   manifest=row['manifest']
   if manifest['distribution']['status']!='reviewed' or manifest['signature']['keyId']!=args.key_id:
    raise ValueError('Reviewed signed manifest required')
  else:raise ValueError('Invalid availability')
 args.output.write_bytes(canonical(envelope(catalog,args.signing_key,args.key_id)))
 print('Signed review candidate only; endpoint publication is a separate authorized action')


if __name__=='__main__':main()
