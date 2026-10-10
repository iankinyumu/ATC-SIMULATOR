# Data and Third-Party Asset Notes

The public repository must not treat public availability as permission to redistribute. Keep source data, generated datasets, charts, voice models, and other downloaded assets out of Git unless their terms have been reviewed and attribution requirements can be met.

## Current sources and handling

| Material | Current handling | Public-repository rule |
|---|---|---|
| EGLL AIP, charts, and supplements | Downloaded locally by the data tools; source documents are not committed | Check NATS access and redistribution terms before including source material or derived datasets. Link to official sources where possible. |
| Airport surface geometry and other OpenStreetMap-derived data | Built into local generated datasets; generated files are ignored | OpenStreetMap data is under ODbL. If a derived database is redistributed, follow the applicable ODbL attribution and share-alike requirements. Keep `© OpenStreetMap contributors` attribution with any permitted public use. |
| Piper/Kokoro programs and voice models | Downloaded locally by `npm run voices:fetch`; model assets are ignored | Respect each program/model license and attribution. The MIT project license does not cover downloaded voice assets. |
| Aircraft/operator reference data and placeholder positions | Project data files | Maintain a source/provenance note for each dataset. Do not add copied third-party databases without permission. |
| API credentials and recordings | Local environment and user microphone | Never commit credentials or raw user recordings. |

The root MIT License covers project-authored code and documentation only. It does not override upstream licenses, database rights, provider terms, or third-party data restrictions. If a file has its own license or attribution, retain it next to the material.

Useful references:

* [OpenStreetMap Copyright and License](https://www.openstreetmap.org/copyright)
* [NATS UK AIP](https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/AIP)
* [Piper voice models](https://github.com/rhasspy/piper)
* [VCTK Corpus](https://datashare.ed.ac.uk/handle/10283/3443)
