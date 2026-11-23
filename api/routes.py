"""HTTP route handlers."""

import hmac
import os
import re
import uuid

from flask import Blueprint, current_app, jsonify, request

from core.exceptions import DocumentLoadError
from core.registry import list_all_plugins

api_bp = Blueprint("api", __name__, url_prefix="/api")
COLLECTION_NAME_REGEX = re.compile(r"^[a-zA-Z0-9_-]+$")


def _service():
    return current_app.config["RAG_SERVICE"]


def _admin_key_required() -> bool:
    """True when the server has an ADMIN_KEY configured."""
    return bool(os.environ.get("ADMIN_KEY"))


def _admin_key_ok() -> bool:
    """True only when ADMIN_KEY is configured in the environment AND the request carries it.

    Fails secure: if ADMIN_KEY is unset, all destructive actions are blocked.
    """
    expected = os.environ.get("ADMIN_KEY")
    if not expected:
        current_app.logger.warning("Admin authentication rejected: ADMIN_KEY is not configured in the environment.")
        return False
    provided = request.headers.get("X-Admin-Key", "")
    return hmac.compare_digest(provided, expected)


@api_bp.route("/config", methods=["GET"])
def client_config():
    """Tell the frontend whether the server has its own Groq key configured."""
    return jsonify({"success": True, "default_key": bool(os.environ.get("GROQ_API_KEY"))})


@api_bp.route("/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"success": False, "error": "No file part in the request"}), 400

    uploaded_file = request.files["file"]
    if uploaded_file.filename == "":
        return jsonify({"success": False, "error": "No file selected"}), 400

    upload_folder = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_folder, exist_ok=True)
    _, ext = os.path.splitext(uploaded_file.filename)
    temp_path = os.path.join(upload_folder, f"{uuid.uuid4()}{ext}")

    try:
        uploaded_file.save(temp_path)
        result = _service().index_document(temp_path, uploaded_file.filename)
        return jsonify({"success": True, "message": "Document uploaded and indexed successfully!", **result})
    except ValueError as error:
        return jsonify({"success": False, "error": str(error)}), 400
    except DocumentLoadError as error:
        return jsonify({"success": False, "error": str(error)}), 400
    except Exception as error:
        current_app.logger.exception("Error during upload and index")
        return jsonify({"success": False, "error": f"Internal Server Error: {error}"}), 500
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@api_bp.route("/query", methods=["POST"])
def query_collection():
    data = request.json or {}
    query = data.get("query", "")
    collection_name = data.get("collection_name", "")
    api_key_override = data.get("api_key", "").strip()
    history = data.get("history")
    if not isinstance(history, list):
        history = None
    
    raw_top_k = data.get("top_k", 4)
    try:
        top_k = max(1, min(int(raw_top_k), 10))
    except (ValueError, TypeError):
        top_k = 4

    if not query.strip():
        return jsonify({"success": False, "error": "Query is required"}), 400
    if not collection_name.strip():
        return jsonify({"success": False, "error": "Collection name is required (upload a document first)"}), 400
    if not COLLECTION_NAME_REGEX.match(collection_name.strip()):
        return jsonify({"success": False, "error": "Invalid collection name format. Only alphanumeric characters, dashes, and underscores are allowed."}), 400

    if not api_key_override and not os.environ.get("GROQ_API_KEY"):
        return jsonify(
            {
                "success": False,
                "error": "Groq API Key is missing. Please configure it in your environment or provide it in request.",
            }
        ), 400

    try:
        payload = _service().query(
            collection_name=collection_name,
            query=query,
            top_k=top_k,
            api_key=api_key_override,
            history=history,
        )
        return jsonify({"success": True, **payload})
    except Exception as error:
        current_app.logger.exception("Error querying collection")
        return jsonify({"success": False, "error": str(error)}), 500


@api_bp.route("/collections", methods=["GET"])
def list_collections():
    try:
        return jsonify({"success": True, "collections": _service().list_collections()})
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500


@api_bp.route("/admin-status", methods=["GET"])
def admin_status():
    """Tell admin clients whether this server is password-protected."""
    persistent = bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY"))
    return jsonify({"success": True, "protected": _admin_key_required(), "persistent": persistent})


@api_bp.route("/admin-verify", methods=["POST"])
def admin_verify():
    """Check an X-Admin-Key header against the configured ADMIN_KEY."""
    if _admin_key_ok():
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Incorrect admin key"}), 401


@api_bp.route("/clear", methods=["POST"])
def clear_collection():
    if not _admin_key_ok():
        return jsonify({"success": False, "error": "Admin key required to delete a collection"}), 401
    data = request.json or {}
    collection_name = data.get("collection_name", "").strip()
    if not collection_name:
        return jsonify({"success": False, "error": "Collection name is required"}), 400
    if not COLLECTION_NAME_REGEX.match(collection_name):
        return jsonify({"success": False, "error": "Invalid collection name format."}), 400
    try:
        success = _service().clear_collection(collection_name)
        if success:
            return jsonify({"success": True, "message": f"Collection {collection_name} cleared successfully."})
        return jsonify({"success": False, "error": "Collection not found or could not be deleted."}), 404
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500


@api_bp.route("/plugins", methods=["GET"])
def get_plugins():
    try:
        return jsonify({"success": True, "plugins": list_all_plugins()})
    except Exception as error:
        return jsonify({"success": False, "error": str(error)}), 500

