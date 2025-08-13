from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_images():
    return []


@router.get("/{image_id}")
async def get_image(image_id: str):
    return {"id": image_id}
