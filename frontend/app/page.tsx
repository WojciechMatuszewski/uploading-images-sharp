"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { fileTypeFromStream } from "file-type";
import { decode } from "blurhash";
import Image from "next/image";

export default function Home() {
	const handleOnChange = async (event: ChangeEvent<HTMLInputElement>) => {
		const { files } = event.currentTarget;
		if (!files) {
			return;
		}

		const file = files[0];
		if (!file) {
			return;
		}

		event.currentTarget.value = "";

		const fileType = await fileTypeFromStream(file.stream());
		if (!fileType) {
			return;
		}

		const { mime } = fileType;
		const presignedUrlResponse = await fetch(
			`${process.env["NEXT_PUBLIC_API_URL"]}/create-presigned-post`,
			{
				method: "POST",
				body: JSON.stringify({
					contentType: mime,
					size: file.size,
				}),
			}
		);
		if (!presignedUrlResponse.ok) {
			return;
		}

		const data = (await presignedUrlResponse.json()) as {
			fields: Record<string, string>;
			url: string;
		};
		const formData = new FormData();
		for (const [key, value] of Object.entries(data.fields)) {
			formData.append(key, value);
		}
		formData.append("file", file);
		const uploadResponse = await fetch(data.url, {
			body: formData,
			method: "POST",
		});
		if (!uploadResponse.ok) {
			console.log(await uploadResponse.text());
		}
	};

	return (
		<div>
			<form>
				<fieldset>
					<label className="btn btn-primary">
						Upload file
						<div className="sr-only">
							<input type="file" multiple={false} onChange={handleOnChange} />
						</div>
					</label>
				</fieldset>
			</form>
			<ImageComponent />
		</div>
	);
}

const blurHash = "UMJHQ]~V%4sp_29G-oxu_2%2IoWEkrxbIpt8";

const ImageComponent = () => {
	const [url, setUrl] = useState<string | null>(null);

	/**
	 * This should be done on the server side.
	 * Otherwise, the UI will "flicker".
	 *
	 * Maybe use the node-canvas package?
	 */
	useEffect(() => {
		const canvas = document.createElement("canvas");

		const context = canvas.getContext("2d");
		if (!context) {
			return;
		}

		const imageData = context.createImageData(480, 640);
		const decoded = decode(blurHash, 480, 640);
		imageData.data.set(decoded);
		context.putImageData(imageData, 0, 0);
		const dataUri = canvas.toDataURL(`image/jpeg`, 0.5);
		setUrl(dataUri);
	}, []);

	if (!url) {
		return;
	}

	return (
		<div className="img-wrapper">
			<Image
				priority={true}
				id="foo"
				alt="cat"
				src={"/fo.jpg"}
				width={480}
				height={640}
				blurDataURL={url}
				placeholder="blur"
			/>
		</div>
	);
};
